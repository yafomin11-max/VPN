/* ══════════════════════════════════════════════════════════════
   parallelogram.vpn — сервис-воркер PWA
   Документы: сеть → при сбое кэш → при сбое офлайн-страница.
   Статика (css/js/шрифты/иконки): сеть с записью в кэш, офлайн — кэш.
   Внешние запросы (Firebase, Turnstile) не перехватываем.
   ══════════════════════════════════════════════════════════════ */
const CACHE = 'pvpn-shell-v1';
const PRECACHE = [
  '/offline.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/logo.png',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .catch(() => {})                     // предкэш не должен ломать установку
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // gstatic/cloudflare — мимо
  if (url.pathname === '/sw.js') return;

  // навигация: сеть → кэш → офлайн
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() =>
          caches.match(req).then((r) => r || caches.match('/offline.html'))
        )
    );
    return;
  }

  // статика: сеть с пополнением кэша, при сбое — кэш
  const isStatic =
    url.pathname.startsWith('/fonts/') ||
    url.pathname.startsWith('/vendor/') ||
    url.pathname.startsWith('/js/') ||
    /\.(css|js|png|svg|jpg|ico|woff2?)$/.test(url.pathname);

  if (!isStatic) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
