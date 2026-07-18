// LCB app service worker: shell — cache-first с фоновым обновлением,
// API — network-first с честным офлайн-фолбэком из кэша.
const SHELL = "lcb-app-shell-v1";
const DATA = "lcb-app-data-v1";
const SHELL_FILES = [
  "./app.html", "./app.css", "./app.js", "./app.webmanifest",
  "./app-icon-192.png", "./app-icon-512.png", "./app-icon-180.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.pathname.includes("/api/")) {
    // network-first: свежие данные, при обрыве — последний снимок + маркер
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copy = r.clone();
          caches.open(DATA).then((c) => c.put(e.request, copy));
          return r;
        })
        .catch(() =>
          caches.match(e.request).then((hit) =>
            hit ||
            new Response(JSON.stringify({ offline: true }), {
              headers: { "Content-Type": "application/json", "X-LCB-Offline": "1" },
            })
          )
        )
    );
    return;
  }
  if (url.origin === location.origin) {
    // shell: cache-first + фоновое обновление (без «протухшего навсегда» кэша)
    e.respondWith(
      caches.match(e.request).then((hit) => {
        const refresh = fetch(e.request)
          .then((r) => {
            caches.open(SHELL).then((c) => c.put(e.request, r.clone()));
            return r;
          })
          .catch(() => hit);
        return hit || refresh;
      })
    );
  }
});
