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
    const tiles = document.querySelectorAll('.feature, .app');
    Array.prototype.forEach.call(tiles, (tile) => {
      tile.addEventListener('pointermove', (e) => {
        const r = tile.getBoundingClientRect();
        tile.style.setProperty('--mx', (((e.clientX - r.left) / r.width) * 100).toFixed(1) + '%');
        tile.style.setProperty('--my', (((e.clientY - r.top) / r.height) * 100).toFixed(1) + '%');
      });
    });
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
