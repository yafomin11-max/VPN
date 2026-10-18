// vpn trial API — Cloudflare Worker
//
// Поток: сайт отправляет Firebase ID token в заголовке Authorization.
// Воркер проверяет подпись токена, берёт uid/email из него (а не из тела запроса),
// проверяет подтверждённый email, защиту от абьюза и создаёт пробного клиента в панели.
//
// Secrets (wrangler secret put ...):
//   API_TOKEN          — токен панели (обязательно)
//   TURNSTILE_SECRET   — секрет Cloudflare Turnstile (необязательно, но рекомендуется)
//   IP_SALT            — любая случайная строка для хеширования IP (необязательно)
//
// Vars (wrangler.toml [vars]): API_BASE, INBOUND_ID, FIREBASE_PROJECT_ID, ALLOWED_ORIGINS,
//   ALLOW_INSECURE_API, TRIAL_DAYS, TRIAL_TRAFFIC_GB, TRIAL_DEVICES, MAX_TRIALS_PER_IP_DAY
//
// Bindings (необязательно): KV namespace RATE_KV — лимиты по IP и по нормализованному email.

const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

// Небольшой список популярных одноразовых доменов. Дополняйте по мере необходимости.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "10minutemail.com",
  "10minutemail.net", "tempmail.com", "temp-mail.org", "temp-mail.io", "yopmail.com",
  "trashmail.com", "throwawaymail.com", "getnada.com", "sharklasers.com", "dispostable.com",
  "maildrop.cc", "fakeinbox.com", "mailnesia.com", "mohmal.com", "tempail.com",
  "emailondeck.com", "mytemp.email", "moakt.com", "burnermail.io", "spamgourmet.com",
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(request, env, ctx) {
    const cors = buildCors(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (request.method !== "POST") throw new HttpError(405, "Метод не поддерживается");

      const origin = request.headers.get("Origin");
      if (origin && !isOriginAllowed(origin, env)) throw new HttpError(403, "Запрещено");

      const cfg = readConfig(env);

      // 1. Авторизация: проверяем Firebase ID token
      const auth = request.headers.get("Authorization") || "";
      const idToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (!idToken) throw new HttpError(401, "Войдите в аккаунт и повторите попытку");

      const claims = await verifyFirebaseToken(idToken, cfg.projectId).catch((e) => {
        console.warn("token rejected:", e.message);
        throw new HttpError(401, "Сессия недействительна. Войдите заново");
      });

      if (!claims.email) throw new HttpError(403, "У аккаунта нет email");
      if (claims.email_verified !== true) {
        throw new HttpError(403, "Подтвердите email: мы отправили вам письмо со ссылкой");
      }

      const email = String(claims.email).toLowerCase();
      const domain = email.split("@")[1] || "";
      if (DISPOSABLE_DOMAINS.has(domain)) {
        throw new HttpError(403, "Одноразовые email-адреса не поддерживаются");
      }

      // 2. Тело запроса (только токен Turnstile, всё остальное берём из токена)
      let body = {};
      try {
        body = await request.json();
      } catch {
        // пустое тело допустимо, если Turnstile выключен
      }

      // 3. Turnstile
      const ip = request.headers.get("CF-Connecting-IP") || "";
      if (env.TURNSTILE_SECRET) {
        await verifyTurnstile(body.turnstileToken, env.TURNSTILE_SECRET, ip);
      }

      // 4. Лимиты (если подключён KV)
      const limiter = await checkLimits(env, cfg, { ip, email });

      // 5. Панель
      const safeName = `trial_${claims.sub.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
      const panel = makePanel(env, cfg);

      const existing = await panel.getClient(safeName);
      if (existing) {
        const link = extractLink(existing);
        if (link && !isExpired(existing)) {
          return json({ success: true, existing: true, link }, 200, cors);
        }
        throw new HttpError(409, "Вы уже использовали пробный период. Оформите подписку, чтобы продолжить");
      }

      const created = await panel.createClient({
        name: safeName,
        days: cfg.trialDays,
        traffic_limit_gb: cfg.trialTrafficGb,
        device_limit: cfg.trialDevices,
        manual: true,
        inbound_ids: [cfg.inboundId],
      });

      const link = extractLink(created.client || {});
      if (!link) {
        console.error("panel returned no link:", JSON.stringify(created).slice(0, 500));
        throw new HttpError(502, "Не удалось получить ссылку. Напишите в поддержку");
      }

      // Лимиты фиксируем только после успешного создания
      await limiter.commit().catch((e) => console.error("limiter commit:", e.message));

      return json({ success: true, link }, 200, cors);
    } catch (err) {
      if (err instanceof HttpError) {
        return json({ success: false, error: err.message }, err.status, cors, err.retryAfter);
      }
      console.error("unhandled:", err && err.stack ? err.stack : err);
      return json({ success: false, error: "Внутренняя ошибка. Попробуйте позже" }, 500, cors);
    }
  },
};

/* ---------------------------- конфиг и CORS ---------------------------- */

function readConfig(env) {
  const apiBase = (env.API_BASE || "").replace(/\/+$/, "");
  if (!env.API_TOKEN) throw new Error("API_TOKEN не задан");
  if (!apiBase) throw new Error("API_BASE не задан");
  if (!env.INBOUND_ID) throw new Error("INBOUND_ID не задан");
  if (!env.FIREBASE_PROJECT_ID) throw new Error("FIREBASE_PROJECT_ID не задан");
  if (!apiBase.startsWith("https://") && env.ALLOW_INSECURE_API !== "true") {
    throw new Error("API_BASE должен быть https:// (или явно задайте ALLOW_INSECURE_API=true)");
  }
  return {
    apiBase,
    inboundId: env.INBOUND_ID,
    projectId: env.FIREBASE_PROJECT_ID,
    trialDays: num(env.TRIAL_DAYS, 1),
    trialTrafficGb: num(env.TRIAL_TRAFFIC_GB, 5),
    trialDevices: num(env.TRIAL_DEVICES, 2),
    maxPerIpDay: num(env.MAX_TRIALS_PER_IP_DAY, 3),
  };
}

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isOriginAllowed(origin, env) {
  const list = allowedOrigins(env);
  return list.length === 0 || list.includes(origin);
}

function buildCors(request, env) {
  const origin = request.headers.get("Origin");
  const h = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  const list = allowedOrigins(env);
  if (list.length === 0) h["Access-Control-Allow-Origin"] = "*";
  else if (origin && list.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function json(obj, status, cors, retryAfter) {
  const headers = { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (retryAfter) headers["Retry-After"] = String(retryAfter);
  return new Response(JSON.stringify(obj), { status, headers });
}

/* ------------------------- Firebase ID token (RS256) ------------------------- */

function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

async function getJwks() {
  const res = await fetch(JWKS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new Error("jwks fetch failed: " + res.status);
  return (await res.json()).keys || [];
}

async function verifyFirebaseToken(token, projectId) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [h, p, s] = parts;

  const header = b64urlToJson(h);
  if (header.alg !== "RS256" || !header.kid) throw new Error("bad header");

  const keys = await getJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("unknown kid");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`)
  );
  if (!ok) throw new Error("bad signature");

  const c = b64urlToJson(p);
  const now = Math.floor(Date.now() / 1000);
  const skew = 60;
  if (c.aud !== projectId) throw new Error("bad aud");
  if (c.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("bad iss");
  if (typeof c.exp !== "number" || c.exp < now - skew) throw new Error("expired");
  if (typeof c.iat !== "number" || c.iat > now + skew) throw new Error("iat in future");
  if (typeof c.sub !== "string" || !c.sub || c.sub.length > 128) throw new Error("bad sub");
  return c;
}

/* ------------------------------ Turnstile ------------------------------ */

async function verifyTurnstile(token, secret, ip) {
  if (!token || typeof token !== "string") {
    throw new HttpError(400, "Подтвердите, что вы не робот, и повторите попытку");
  }
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  let data;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(5000),
    });
    data = await res.json();
  } catch (e) {
    console.error("turnstile error:", e.message);
    throw new HttpError(502, "Не удалось проверить капчу. Попробуйте позже");
  }
  if (!data.success) throw new HttpError(403, "Проверка на робота не пройдена. Обновите страницу и попробуйте снова");
}

/* ------------------------------- Лимиты (KV) ------------------------------- */

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// gmail: убираем точки и +tag, чтобы a.b+1@gmail.com == ab@gmail.com
function normalizeEmail(email) {
  let [local, domain] = email.split("@");
  if (domain === "googlemail.com") domain = "gmail.com";
  local = local.split("+")[0];
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

async function checkLimits(env, cfg, { ip, email }) {
  const kv = env.RATE_KV;
  if (!kv) return { commit: async () => {} };

  const salt = env.IP_SALT || "";
  const ipKey = ip ? `ip:${await sha256Hex(salt + ip)}` : null;
  const mailKey = `mail:${await sha256Hex(normalizeEmail(email))}`;

  if (await kv.get(mailKey)) {
    throw new HttpError(409, "Пробный период для этого email уже был использован");
  }

  let ipCount = 0;
  if (ipKey) {
    ipCount = parseInt((await kv.get(ipKey)) || "0", 10);
    if (ipCount >= cfg.maxPerIpDay) {
      const e = new HttpError(429, "Слишком много запросов с вашего адреса. Попробуйте завтра");
      e.retryAfter = 3600;
      throw e;
    }
  }

  return {
    commit: async () => {
      // email храним без срока: пробник один на человека. IP — сутки (минимум для KV 60 c).
      await kv.put(mailKey, "1");
      if (ipKey) await kv.put(ipKey, String(ipCount + 1), { expirationTtl: 86400 });
    },
  };
}

/* --------------------------------- Панель --------------------------------- */

function makePanel(env, cfg) {
  const headers = { Authorization: `Bearer ${env.API_TOKEN}` };

  async function call(path, init = {}) {
    try {
      return await fetch(`${cfg.apiBase}${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers || {}) },
        signal: AbortSignal.timeout(10000),
      });
    } catch (e) {
      console.error("panel unreachable:", path, e.message);
      throw new HttpError(502, "Сервер временно недоступен. Попробуйте позже");
    }
  }

  return {
    // null — клиента нет (404); любая другая ошибка — исключение
    async getClient(name) {
      const res = await call(`/clients/${encodeURIComponent(name)}`);
      if (res.status === 404) return null;
      if (!res.ok) {
        console.error("panel GET client status:", res.status);
        throw new HttpError(502, "Сервер временно недоступен. Попробуйте позже");
      }
      const data = await res.json().catch(() => ({}));
      return data.client || data;
    },

    async createClient(payload) {
      const res = await call("/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) throw new HttpError(409, "Пробный период уже активирован");
      if (!res.ok || data.ok === false) {
        console.error("panel create failed:", res.status, JSON.stringify(data).slice(0, 500));
        throw new HttpError(502, "Не удалось создать доступ. Попробуйте позже или напишите в поддержку");
      }
      return data;
    },
  };
}

function extractLink(client) {
  return client.sub_url || client.subscription_url || null;
}

// Формат ответа панели для существующего клиента неизвестен, поэтому проверяем
// несколько возможных полей. Если ничего не нашли — считаем, что активен.
function isExpired(client) {
  if (client.enabled === false || client.expired === true) return true;
  const raw = client.expire_at ?? client.expires_at ?? client.expiry_time ?? client.expiry;
  if (raw === undefined || raw === null || raw === 0 || raw === "") return false;
  const ts = typeof raw === "number" ? (raw > 1e12 ? raw : raw * 1000) : Date.parse(raw);
  return Number.isFinite(ts) && ts < Date.now();
}
