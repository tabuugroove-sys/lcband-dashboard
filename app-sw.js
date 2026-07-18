/* LCB app service worker v2 (§5.4, §5.6 ТЗ):
   - версия в имени кэша — бампать вместе с APP_VERSION в app.js;
   - shell: cache-first + фоновое обновление; активация нового SW — по сообщению
     SKIP_WAITING (тост «Доступна новая версия» в приложении);
   - /api/: network-first; успешный ответ кэшируется с меткой X-LCB-Cached-At,
     офлайн-фолбэк отдаёт снимок с X-LCB-Offline:1 → плашка «Офлайн · снимок HH:MM»;
   - /api/health НЕ кэшируется и не имеет фолбэка — heartbeat индикатора честный. */
const VERSION = "2.4.0";
const SHELL = "lcb-app-shell-" + VERSION;
const DATA = "lcb-app-data-" + VERSION;
const SHELL_FILES = [
  "./app.html", "./app.css", "./app.js",
  "./app-api.js", "./app-cal.js", "./app-chats.js",
  "./app-today.js", "./app-event.js", "./app-sys.js", "./app-broadcast.js",
  "./app.webmanifest",
  "./app-icon-192.png", "./app-icon-512.png", "./app-icon-180.png",
];

self.addEventListener("install", (e) => {
  // cache:"no-cache" = форс-ревалидация: иначе addAll может утащить в новый
  // versioned-кэш СТАРЫЕ модули из HTTP-кэша браузера (Pages шлёт max-age=600),
  // и APP_VERSION нового app.js разъедется с содержимым остальных файлов
  e.waitUntil(caches.open(SHELL).then((c) =>
    Promise.all(SHELL_FILES.map((u) =>
      fetch(new Request(u, { cache: "no-cache" })).then((r) => { if (r.ok) return c.put(u, r); })
    ))
  ));
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

async function stampedPut(req, resp) {
  try {
    const c = await caches.open(DATA);
    const body = await resp.blob();
    const h = new Headers(resp.headers);
    h.set("X-LCB-Cached-At", String(Date.now()));
    await c.put(req, new Response(body, { status: resp.status, statusText: resp.statusText, headers: h }));
  } catch (_) {}
}

async function offlineFallback(req) {
  const hit = await caches.match(req);
  if (hit) {
    try {
      const body = await hit.blob();
      const h = new Headers(hit.headers);
      h.set("X-LCB-Offline", "1");
      return new Response(body, { status: hit.status, statusText: hit.statusText, headers: h });
    } catch (_) { return hit; }
  }
  return new Response(JSON.stringify({ offline: true }), {
    headers: { "Content-Type": "application/json", "X-LCB-Offline": "1" },
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // POST не перехватываем: офлайн-очередей approve нет (§5.4)
  const url = new URL(req.url);
  if (url.pathname.endsWith("/api/health")) return; // heartbeat — только сеть, без кэша
  if (url.pathname.includes("/api/")) {
    e.respondWith(
      fetch(req)
        .then((r) => {
          if (r.ok) stampedPut(req, r.clone());
          return r;
        })
        .catch(() => offlineFallback(req))
    );
    return;
  }
  if (url.origin === location.origin) {
    // shell: cache-first + фоновое обновление (без «протухшего навсегда» кэша);
    // refresh тоже мимо HTTP-кэша, чтобы не переливать в SW-кэш то же старьё
    e.respondWith(
      caches.match(req).then((hit) => {
        const refresh = fetch(new Request(req.url, { cache: "no-cache" }))
          .then((r) => {
            if (r.ok) caches.open(SHELL).then((c) => c.put(req, r.clone()));
            return r;
          })
          .catch(() => hit);
        return hit || refresh;
      })
    );
  }
});
