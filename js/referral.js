/* ══════════════════════════════════════════════════════════════
   parallelogram.vpn — партнёрская программа (интерфейс)
   Ссылка вида ?ref=CODE, личная ссылка из email, копирование,
   счётчик приглашений. Логику начисления делает воркер.
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const API = 'https://vpn.yafomin11.workers.dev';
  const STORE = 'pg_ref';
  const TTL = 30 * 24 * 60 * 60 * 1000;

  const input = document.getElementById('refLink');
  const copyBtn = document.getElementById('refCopy');
  const note = document.getElementById('refNote');
  const invitesEl = document.getElementById('refInvites');
  const daysEl = document.getElementById('refDays');
  const badge = document.querySelector('.referral__badge');
  if (!input || !copyBtn) return;

  const navUser = document.getElementById('navUser');
  const emailEl = document.getElementById('navUserEmail');
  const params = new URLSearchParams(location.search);
  const DEMO = params.has('refdemo');

  /* ── запоминаем код из ссылки ─────────────────────────────── */
  const incoming = (params.get('ref') || '').trim().toLowerCase();
  if (incoming && /^[a-z0-9]{4,12}$/.test(incoming)) {
    try {
      localStorage.setItem(STORE, JSON.stringify({ code: incoming, at: Date.now() }));
    } catch (e) { /* приватный режим */ }
  }

  /* ── короткий код из email (воркер считает такой же) ──────── */
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  function codeFromEmail(email) {
    return fnv1a('pg:' + email.trim().toLowerCase()).toString(36).padStart(7, '0').slice(-7);
  }

  function baseUrl() {
    if (location.protocol === 'file:') return 'https://parallelogram.vpn/';
    return location.origin + location.pathname.replace(/index\.html$/, '');
  }

  function setNote(text, isWarn) {
    if (!note) return;
    note.textContent = text;
    note.style.color = isWarn ? '#f0b0b0' : '';
  }

  /* ── состояние ────────────────────────────────────────────── */
  let email = '';
  let statsRequest = 0;

  function renderLoggedOut() {
    email = '';
    input.value = '';
    input.placeholder = 'Войдите, чтобы получить ссылку';
    copyBtn.textContent = 'Войти';
    if (invitesEl) invitesEl.textContent = '0';
    if (daysEl) daysEl.textContent = '0';
    setNote('Войдите в аккаунт — ссылка появится здесь.', false);
  }

  function renderLoggedIn(mail) {
    email = mail;
    const link = baseUrl() + '?ref=' + codeFromEmail(mail);
    input.value = link;
    input.placeholder = '';
    copyBtn.textContent = 'Скопировать';
    setNote('Отправьте ссылку другу. Дни начислим после подтверждения почты и первого ключа.', false);
    if (!params.has('refdemo')) loadStats(codeFromEmail(mail));
  }

  async function loadStats(code) {
    const req = ++statsRequest;
    try {
      const res = await fetch(API + '/referral/stats?code=' + encodeURIComponent(code), {
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) throw new Error('no endpoint');
      const data = await res.json();
      if (req !== statsRequest) return;
      if (invitesEl) invitesEl.textContent = String(data.invites | 0);
      if (daysEl) daysEl.textContent = String(data.days | 0);
    } catch (e) {
      if (req !== statsRequest) return;
      setNote('Счётчик включится, когда программа заработает. Ссылка уже рабочая.', false);
    }
  }

  /* ── проверяем, включена ли программа на сервере ──────────── */
  let backendLive = false;
  (function probe() {
    if (params.has('refdemo')) { backendLive = true; return; }
    fetch(API + '/referral/stats?code=probe', { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('off'); return r.json(); })
      .then(function () { backendLive = true; })
      .catch(function () {
        backendLive = false;
        if (badge) badge.textContent = 'скоро';
        if (note && !email) {
          note.textContent = 'Программа запускается: ссылка уже рабочая, начисление включим сразу после старта.';
        }
      });
  })();

  /* ── копирование ──────────────────────────────────────────── */
  copyBtn.addEventListener('click', async function () {
    if (!email) {
      if (typeof window.openAuth === 'function') window.openAuth('register');
      return;
    }
    try {
      await navigator.clipboard.writeText(input.value);
    } catch (e) {
      input.removeAttribute('readonly');
      input.select();
      document.execCommand('copy');
      input.setAttribute('readonly', 'readonly');
    }
    const prev = copyBtn.textContent;
    copyBtn.textContent = 'Скопировано';
    setTimeout(function () { copyBtn.textContent = prev; }, 1700);
  });

  /* ── следим за состоянием входа через шапку ───────────────── */
  function sync() {
    if (DEMO) return;
    const active = navUser && navUser.classList.contains('active');
    const mail = active && emailEl ? (emailEl.textContent || '').trim() : '';
    if (mail && mail !== email) renderLoggedIn(mail);
    else if (!mail && email) renderLoggedOut();
  }

  if (navUser) {
    new MutationObserver(sync).observe(navUser, {
      attributes: true, childList: true, subtree: true, characterData: true
    });
  }
  sync();

  /* ── демо-режим для превью (?refdemo=1) ───────────────────── */
  if (params.has('refdemo')) {
    renderLoggedIn('demo@parallelogram.vpn');
    if (invitesEl) invitesEl.textContent = '4';
    if (daysEl) daysEl.textContent = '28';
    setNote('Отправьте ссылку другу. Дни начислим после подтверждения почты и первого ключа.', false);
  }

  if (!email && !params.has('refdemo')) renderLoggedOut();
})();
