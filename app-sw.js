/* Kill-switch service worker (CHG-20260815-007). Legacy-приложение app.html
   выведено из эксплуатации — остаётся только V2 (core-app.html, :8880).
   Старые установленные SW подтянут этот файл при очередной проверке
   обновления, активируются без ожидания, удалят все кэши, снимут регистрацию
   и перезагрузят открытые вкладки — те попадут на надгробие app.html. */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: "window" });
    windows.forEach((client) => client.navigate(client.url));
  })());
});
