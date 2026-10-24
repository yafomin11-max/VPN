/* ══════════════════════════════════════════════════════════════
   parallelogram.vpn — реферальная программа для Cloudflare Worker
   ──────────────────────────────────────────────────────────────
   Модуль не подменяет ваш роутер: он отдаёт три обработчика,
   которые вы вызываете после проверки Firebase ID-токена,
   и одну функцию начисления, которую вызываете при выдаче ключа.

   Требуется KV-биндинг REFERRAL_KV и переменные окружения:
     PANEL_URL          https://<нода>.h1cloud.net:<порт>
     PANEL_API_TOKEN    токен панели (секрет, только на сервере)
     ALLOW_ORIGIN       https://parallelogram.vpn

   ── Подключение в fetch-обработчике ───────────────────────────
     import { handleStats, handleMe, handleAttach, preflight } from './referral.js';

     if (request.method === 'OPTIONS') return preflight(env);

     if (url.pathname === '/referral/stats') {
       return handleStats(env, url.searchParams.get('code'));
     }
     if (url.pathname === '/referral/me') {
       const user = await verifyFirebaseToken(request, env); // ваш существующий код
       return handleMe(env, user);
     }
     if (url.pathname === '/referral/attach') {
       const user = await verifyFirebaseToken(request, env);
       const body = await request.json();
       return handleAttach(env, user, body.ref);
     }

   ── Начисление при выдаче ключа ───────────────────────────────
     await creditSignup(env, user, panelName);
   ══════════════════════════════════════════════════════════════ */

const BONUS_DAYS = 7;
const CODE_RE = /^[a-z0-9]{4,12}$/;

/* ── утилиты ──────────────────────────────────────────────────── */

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Должно совпадать с js/referral.js на сайте
export function codeFromEmail(email) {
  return fnv1a('pg:' + String(email || '').trim().toLowerCase())
    .toString(36)
    .padStart(7, '0')
    .slice(-7);
}

export function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || 'https://parallelogram.vpn',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function json(env, body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(env) }
  });
}

// ВАЖНО: если клиенты в панели называются иначе (tg_…, web_…),
// поменяйте функцию под свою схему.
function panelNameFor(user) {
  return user.panelName || user.email;
}

/* ── панель H1 ────────────────────────────────────────────────── */

async function panelGetClient(env, name) {
  const res = await fetch(env.PANEL_URL + '/api/clients/' + encodeURIComponent(name), {
    headers: { Authorization: 'Bearer ' + env.PANEL_API_TOKEN }
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data && data.client ? data.client : null;
}

/**
 * Продление на days дней через абсолютный expires_at.
 * expires_at, а не days: повторный запрос с той же датой ничего не меняет,
 * тогда как days прибавился бы ещё раз.
 */
async function panelExtend(env, name, days) {
  const client = await panelGetClient(env, name);
  const now = Math.floor(Date.now() / 1000);

  // expires_at в ответе панели — секунды. Если там окажутся миллисекунды,
  // проверьте по GET /api/clients/{name} и поправьте здесь.
  const current = client && Number(client.expires_at) ? Number(client.expires_at) : 0;
  const base = Math.max(current, now);
  const target = base + days * 86400;

  const res = await fetch(env.PANEL_URL + '/api/clients/' + encodeURIComponent(name), {
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer ' + env.PANEL_API_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ expires_at: target })
  });

  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.ok) {
    throw new Error((out && out.error) || 'panel ' + res.status);
  }
  return target;
}

/* ── публичный API ────────────────────────────────────────────── */

/** GET /referral/stats?code=... — без авторизации, неизвестный код = нули */
export async function handleStats(env, code) {
  const clean = String(code || '').trim().toLowerCase();
  if (!CODE_RE.test(clean)) return json(env, { invites: 0, days: 0 });

  const rec = await env.REFERRAL_KV.get('ref:user:' + clean, 'json');
  return json(env, {
    invites: (rec && rec.invites) || 0,
    days: (rec && rec.days) || 0
  });
}

/** Создаёт запись пользователя, если её ещё нет. Возвращает {code, rec}. */
export async function ensureUser(env, user) {
  const code = codeFromEmail(user.email);
  const key = 'ref:user:' + code;
  let rec = await env.REFERRAL_KV.get(key, 'json');

  if (!rec) {
    rec = { email: user.email, invites: 0, days: 0 };
    await env.REFERRAL_KV.put(key, JSON.stringify(rec));
  }
  return { code: code, rec: rec };
}

/** POST /referral/me — создаёт запись пользователя и возвращает её статистику */
export async function handleMe(env, user) {
  if (!user || !user.uid || !user.email) {
    return json(env, { ok: false, error: 'unauthorized' }, 401);
  }

  const { code, rec } = await ensureUser(env, user);
  return json(env, { ok: true, code: code, invites: rec.invites || 0, days: rec.days || 0 });
}

/** POST /referral/attach — запоминает, кто пригласил (ещё ничего не начисляя) */
export async function handleAttach(env, user, ref) {
  if (!user || !user.uid || !user.email) {
    return json(env, { ok: false, error: 'unauthorized' }, 401);
  }

  const clean = String(ref || '').trim().toLowerCase();
  if (!CODE_RE.test(clean)) return json(env, { ok: false, error: 'bad_ref' }, 400);

  if (clean === codeFromEmail(user.email)) {
    return json(env, { ok: false, error: 'self_invite' }, 400);
  }

  const inviter = await env.REFERRAL_KV.get('ref:user:' + clean, 'json');
  if (!inviter) return json(env, { ok: false, error: 'unknown_ref' }, 404);

  const credited = await env.REFERRAL_KV.get('ref:credited:' + user.uid);
  if (credited) return json(env, { ok: true, already: true });

  await env.REFERRAL_KV.put('ref:pending:' + user.uid, clean);
  return json(env, { ok: true });
}

/**
 * Начисление после успешной выдачи ключа.
 * Вызывать в обработчике, который уже проверил токен и создал клиента.
 * Возвращает true, если бонус применился.
 */
export async function creditSignup(env, user, panelName) {
  if (!user || !user.uid || !user.email) return false;

  // у каждого, кто получил ключ, должен быть свой код —
  // иначе по нему нельзя будет пригласить
  await ensureUser(env, user);

  const pending = await env.REFERRAL_KV.get('ref:pending:' + user.uid);
  if (!pending) return false;

  if (await env.REFERRAL_KV.get('ref:credited:' + user.uid)) {
    await env.REFERRAL_KV.delete('ref:pending:' + user.uid);
    return false;
  }

  const inviterKey = 'ref:user:' + pending;
  const inviter = await env.REFERRAL_KV.get(inviterKey, 'json');
  if (!inviter) {
    await env.REFERRAL_KV.delete('ref:pending:' + user.uid);
    return false;
  }

  // 1. пригласившему — в панель, если клиент уже есть
  const inviterName = panelNameFor({ email: inviter.email, uid: null });
  let inviterCredited = false;
  try {
    await panelExtend(env, inviterName, BONUS_DAYS);
    inviterCredited = true;
  } catch (e) {
    // клиента ещё нет в панели — дни копим в KV, применим при создании
    inviterCredited = false;
  }

  // 2. приглашённому — тоже бонус
  try {
    await panelExtend(env, panelName || panelNameFor(user), BONUS_DAYS);
  } catch (e) {
    /* не критично: основной клиент уже создан, проверим вручную */
  }

  // 3. учёт
  inviter.invites = (inviter.invites || 0) + 1;
  inviter.days = (inviter.days || 0) + (inviterCredited ? 0 : BONUS_DAYS);
  await env.REFERRAL_KV.put(inviterKey, JSON.stringify(inviter));

  await env.REFERRAL_KV.put('ref:credited:' + user.uid, pending);
  await env.REFERRAL_KV.delete('ref:pending:' + user.uid);

  return true;
}

/** CORS-префлайт */
export function preflight(env) {
  return new Response(null, { status: 204, headers: cors(env) });
}
