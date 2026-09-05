/* Saturday Signal v1.1.0. Live scores deliberately bypass service-worker caches. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* Still display a visible notification. */ }
  const title = typeof payload.title === "string" ? payload.title : "Saturday Signal";
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof payload.body === "string" ? payload.body : "There is an update on your football watchlist.",
    icon: "/icon-192.png", badge: "/icon-192.png",
    tag: typeof payload.eventId === "string" ? payload.eventId : "saturday-signal",
    renotify: false,
    data: { url: typeof payload.url === "string" ? payload.url : "/" },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  let url = new URL("/", self.location.origin);
  try { const requested = new URL(event.notification.data?.url || "/", self.location.origin); if (requested.origin === self.location.origin) url = requested; } catch { /* Home is a safe fallback. */ }
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) if (new URL(client.url).origin === url.origin) { await client.navigate(url.href); return client.focus(); }
    return self.clients.openWindow(url.href);
  })());
});
