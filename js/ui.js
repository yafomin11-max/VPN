/* ══════════════════════════════════════════════════════════════
   parallelogram.vpn — интерфейсные мелочи
   Ничего не переопределяет: только классы и подсветки.
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const html = document.documentElement;
  html.classList.remove('no-js');

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover:hover) and (pointer:fine)').matches;

  /* ── липкая навигация ─────────────────────────────────────── */
  const nav = document.querySelector('nav');
  let ticking = false;

  function onScroll() {
    if (nav) nav.classList.toggle('is-stuck', window.scrollY > 24);
    ticking = false;
  }
  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(onScroll);
    }
  }, { passive: true });
  onScroll();

  /* ── появление блоков ─────────────────────────────────────── */
  const revealEls = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

  if ('IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        el.classList.add('in');
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });

    revealEls.forEach((el, i) => {
      el.style.setProperty('--rd', (Math.min(i % 6, 5) * 0.06).toFixed(2) + 's');
      io.observe(el);
    });
  } else {
    revealEls.forEach((el) => el.classList.add('in'));
  }

  /* ── подсветка активного раздела ──────────────────────────── */
  const navButtons = Array.prototype.slice.call(document.querySelectorAll('.nav-links button'));
  const sectionIds = ['features', 'servers', 'pricing', 'guide', 'apps', 'faq'];
  const sections = sectionIds.map((id) => document.getElementById(id)).filter(Boolean);

  if ('IntersectionObserver' in window && sections.length) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const id = entry.target.id;
        navButtons.forEach((b) => {
          const match = (b.getAttribute('onclick') || '').indexOf("'" + id + "'") > -1;
          b.classList.toggle('is-active', match);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
    sections.forEach((s) => spy.observe(s));
  }

  /* ── подсветка под курсором в плитках ─────────────────────── */
  if (finePointer && !reduceMotion) {
    const tiles = document.querySelectorAll('.feature, .app, .plan');
    Array.prototype.forEach.call(tiles, (tile) => {
      tile.addEventListener('pointermove', (e) => {
        const r = tile.getBoundingClientRect();
        tile.style.setProperty('--mx', (((e.clientX - r.left) / r.width) * 100).toFixed(1) + '%');
        tile.style.setProperty('--my', (((e.clientY - r.top) / r.height) * 100).toFixed(1) + '%');

        // угол для неоновой кромки
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
        tile.style.setProperty('--edge', angle.toFixed(1) + 'deg');
      });
    });
  }

  /* ── световой прожектор в секциях ─────────────────────────── */
  if (finePointer && !reduceMotion) {
    let raf = 0;
    let lastEvent = null;

    document.addEventListener('pointermove', (e) => {
      const section = e.target && e.target.closest ? e.target.closest('.section') : null;
      if (!section) return;
      lastEvent = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!lastEvent) return;
        const el = lastEvent.target.closest('.section');
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--px', (lastEvent.clientX - r.left).toFixed(0) + 'px');
        el.style.setProperty('--py', (lastEvent.clientY - r.top).toFixed(0) + 'px');
      });
    }, { passive: true });
  }

  /* ── мягкий фолбэк навигации, если Firebase-модуль не загрузился ── */
  window.addEventListener('load', () => {
    setTimeout(() => {
      if (typeof window.scrollToSection === 'function') return;
      window.scrollToSection = function (id) {
        if (id === 'top') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        const el = document.getElementById(id);
        if (!el) return;
        const navEl = document.querySelector('nav');
        const navH = navEl ? navEl.offsetHeight : 0;
        window.scrollTo({
          top: el.getBoundingClientRect().top + window.pageYOffset - navH + 10,
          behavior: 'smooth'
        });
      };
    }, 1500);
  });
})();

/* ══════════════════════════════════════════════════════════════
   v2: прелоадер, прогресс скролла, 3D-tilt карточек,
   магнитные кнопки, скрэмбл-текст, мобильное меню, вибро
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover:hover) and (pointer:fine)').matches;

  // вибро-отклик на телефонах (безопасно: игнорируется там, где нет API)
  const buzz = (ms) => {
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
  };

  /* ── мобильное меню ───────────────────────────────────────── */
  (function mobileMenu() {
    const burger = document.getElementById('navBurger');
    const menu = document.getElementById('mobileMenu');
    if (!burger || !menu) return;

    function setOpen(v) {
      menu.classList.toggle('open', v);
      burger.classList.toggle('is-open', v);
      burger.setAttribute('aria-expanded', String(v));
      menu.setAttribute('aria-hidden', String(!v));
      document.body.classList.toggle('menu-open', v);
      buzz(v ? 12 : 6);
    }

    burger.addEventListener('click', () => {
      setOpen(!menu.classList.contains('open'));
    });
    Array.prototype.forEach.call(menu.querySelectorAll('button'), (b) => {
      b.addEventListener('click', () => setOpen(false));
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.classList.contains('open')) setOpen(false);
    });
  })();

  /* ── вибро-отклик на главных кнопках ──────────────────────── */
  (function haptics() {
    if (!('vibrate' in navigator)) return;
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#trialBtn, .plan .btn, #refCopy, .nav-cta, .nav-burger, .mobile-menu button, .referral__copy')) return;
      buzz(8);
    }, { passive: true });
  })();

  /* ── PWA: регистрация сервис-воркера ──────────────────────── */
  (function pwa() {
    if (!('serviceWorker' in navigator)) return;
    const host = location.hostname;
    if (location.protocol !== 'https:' && host !== 'localhost' && host !== '127.0.0.1') return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  })();

  /* ── PWA: кнопка «Установить приложение» ───────────────────── */
  (function installPrompt() {
    const chip = document.getElementById('installChip');
    if (!chip) return;
    let deferred = null;

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferred = e;
      chip.hidden = false;
    });

    chip.addEventListener('click', async () => {
      buzz(8);
      if (!deferred) return;
      deferred.prompt();
      try { await deferred.userChoice; } catch (err) {}
      deferred = null;
      chip.hidden = true;
    });

    window.addEventListener('appinstalled', () => {
      deferred = null;
      chip.hidden = true;
    });
  })();

  /* ── прелоадер ────────────────────────────────────────────── */
  (function preloader() {
    const loader = document.getElementById('loader');
    const pctEl = document.getElementById('loaderPct');
    const barEl = document.getElementById('loaderBar');
    if (!loader) return;

    const doc = document.documentElement;
    doc.classList.add('is-loading');

    let loaded = document.readyState === 'complete';
    let pct = 0;
    let done = false;
    const started = performance.now();

    window.addEventListener('load', () => { loaded = true; });
    setTimeout(() => { loaded = true; }, 2400);   // страховка, никогда не зависаем

    function finish() {
      if (done) return;
      done = true;
      pct = 100;
      pctEl.textContent = '100';
      barEl.style.transform = 'scaleX(1)';
      setTimeout(() => {
        loader.classList.add('done');
        doc.classList.remove('is-loading');
        document.body.classList.add('booted');
        setTimeout(() => loader.remove(), 900);
      }, 180);
    }

    const timer = setInterval(() => {
      if (done) { clearInterval(timer); return; }
      pct = Math.min(pct + 1 + Math.random() * 3.2, loaded ? 100 : 92);
      pctEl.textContent = String(Math.floor(pct)).padStart(2, '0');
      barEl.style.transform = 'scaleX(' + (pct / 100).toFixed(3) + ')';
      if (pct >= 100) { clearInterval(timer); finish(); }
      // если грузится слишком долго — открываем сайт принудительно
      if (performance.now() - started > 2600) { loaded = true; }
    }, 55);
  })();

  /* ── полоса прогресса скролла ─────────────────────────────── */
  (function progressBar() {
    const bar = document.getElementById('progress');
    if (!bar) return;
    let ticking = false;
    function update() {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const k = max > 0 ? Math.min(1, window.scrollY / max) : 0;
      bar.style.transform = 'scaleX(' + k.toFixed(4) + ')';
      ticking = false;
    }
    window.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  })();

  /* ── 3D-tilt карточек ─────────────────────────────────────── */
  (function tilt() {
    if (!finePointer || reduceMotion) return;
    const cards = document.querySelectorAll('.feature, .plan, .app');
    Array.prototype.forEach.call(cards, (card) => {
      card.classList.add('tilt-3d');
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        card.style.setProperty('--ry', (nx * 6).toFixed(2) + 'deg');
        card.style.setProperty('--rx', (-ny * 6).toFixed(2) + 'deg');
      });
      card.addEventListener('pointerleave', () => {
        card.style.setProperty('--ry', '0deg');
        card.style.setProperty('--rx', '0deg');
      });
    });
  })();

  /* ── магнитные кнопки ─────────────────────────────────────── */
  (function magnets() {
    if (!finePointer || reduceMotion) return;
    const btns = document.querySelectorAll('.nav-cta, .hero-buttons .btn, .referral__copy, .footer-support');
    Array.prototype.forEach.call(btns, (btn) => {
      btn.classList.add('magnet');
      const STRENGTH = 0.22;
      const MAX = 7;
      btn.addEventListener('pointermove', (e) => {
        const r = btn.getBoundingClientRect();
        let dx = (e.clientX - (r.left + r.width / 2)) * STRENGTH;
        let dy = (e.clientY - (r.top + r.height / 2)) * STRENGTH;
        dx = Math.max(-MAX, Math.min(MAX, dx));
        dy = Math.max(-MAX, Math.min(MAX, dy));
        btn.style.setProperty('--mgx', dx.toFixed(1) + 'px');
        btn.style.setProperty('--mgy', dy.toFixed(1) + 'px');
      });
      btn.addEventListener('pointerleave', () => {
        btn.style.setProperty('--mgx', '0px');
        btn.style.setProperty('--mgy', '0px');
      });
    });
  })();

  /* ── скрэмбл-декодирование тегов секций ────────────────────── */
  (function scramble() {
    if (reduceMotion) return;
    const GLYPHS = '█▓▒░<>/\\|#*+—0123456789ABCDEF';
    const tags = document.querySelectorAll('.sec-tag, .referral__kicker, .stat-value');

    function decode(el) {
      const original = el.getAttribute('data-text') || el.textContent;
      el.setAttribute('data-text', original);
      let frame = 0;
      const total = original.length;
      const steps = Math.max(10, total + 8);
      const iv = setInterval(() => {
        frame++;
        const revealed = Math.floor((frame / steps) * total);
        let out = original.slice(0, revealed);
        for (let i = revealed; i < total; i++) {
          out += original[i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
        }
        el.textContent = out;
        if (frame >= steps) {
          clearInterval(iv);
          el.textContent = original;
        }
      }, 34);
    }

    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        decode(entry.target);
      });
    }, { threshold: 0.4 });
    tags.forEach((t) => io.observe(t));
  })();

  /* ── лёгкий параллакс hero-контента за курсором ────────────── */
  (function heroParallax() {
    if (!finePointer || reduceMotion) return;
    const inner = document.querySelector('.hero__inner');
    if (!inner) return;
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
    window.addEventListener('pointermove', (e) => {
      tx = (e.clientX / window.innerWidth - 0.5) * -10;
      ty = (e.clientY / window.innerHeight - 0.5) * -6;
    }, { passive: true });
    (function loop() {
      cx += (tx - cx) * 0.05;
      cy += (ty - cy) * 0.05;
      inner.style.transform = 'translate(' + cx.toFixed(2) + 'px,' + cy.toFixed(2) + 'px)';
      raf = requestAnimationFrame(loop);
    })();
  })();
})();
