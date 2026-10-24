/* ══════════════════════════════════════════════════════════════
   parallelogram.vpn — привязка приглашения к аккаунту
   Отдельный модуль: использует уже созданное Firebase-приложение
   основного скрипта и не меняет его логику.

   1) POST /referral/me      — создаёт запись пользователя (его код)
   2) POST /referral/attach  — сообщает, кто его пригласил
   Начисление делает воркер при выдаче ключа.
   ══════════════════════════════════════════════════════════════ */
import { getApps } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

const API = 'https://vpn.yafomin11.workers.dev';
const STORE = 'pg_ref';

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function codeFromEmail(email) {
  return fnv1a('pg:' + String(email || '').trim().toLowerCase()).toString(36).padStart(7, '0').slice(-7);
}

function readSavedRef() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!v || !v.code) return null;
    return v;
  } catch (e) {
    return null;
  }
}

const apps = getApps();

if (apps.length) {
  const auth = getAuth(apps[0]);

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    let token;
    try {
      token = await user.getIdToken();
    } catch (e) {
      return;
    }

    const headers = { Authorization: 'Bearer ' + token };

    // 1. регистрируем код пользователя, чтобы по нему можно было приглашать
    try {
      await fetch(API + '/referral/me', { method: 'POST', headers: headers });
    } catch (e) {
      /* воркер может быть ещё не обновлён */
    }

    // 2. привязываем приглашение
    const saved = readSavedRef();
    if (!saved || !saved.code || saved.attached) return;
    if (user.email && saved.code === codeFromEmail(user.email)) return;

    try {
      const res = await fetch(API + '/referral/attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ ref: saved.code })
      });
      if (res.ok) {
        saved.attached = true;
        localStorage.setItem(STORE, JSON.stringify(saved));
      }
    } catch (e) {
      /* тихо: повторим при следующем входе */
    }
  });
}
