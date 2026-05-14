// Service Worker — network-first для app shell (HTML/JS/CSS).
// До v29 был cache-first → пользователь не видел свежие деплои до hard-reload.
const CACHE = "lcb-v38-ai-trend-range-tabs";
const SHELL = ['./index.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Google Sheets — network first, fall back to cache
  if (url.includes('docs.google.com')) {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return resp;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // App shell (HTML/JS/CSS на нашем origin) — NETWORK FIRST.
  // Кешируем для офлайна, но всегда пробуем сначала свежее с сервера.
  if (e.request.mode === 'navigate' || url.endsWith('.html') || url.endsWith('.js') || url.endsWith('.css')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' })
        .then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return resp;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Остальное (картинки, шрифты, API) — cache-first для скорости
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
