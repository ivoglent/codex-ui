/*
 * Angular continues to own caching. This wrapper renders the backend's Web
 * Push payload into a visible browser notification for this PWA.
 */
importScripts("./ngsw-worker.js");

self.addEventListener("push", (event) => {
  const payload = readPayload(event);
  if (!payload || typeof payload.title !== "string" || !payload.title) return;
  const title = payload.title;
  const body = typeof payload.message === "string" ? payload.message : "";
  const clickAction = typeof payload.clickAction === "string" ? payload.clickAction : "/";
  event.waitUntil(self.registration.showNotification(title, { body, tag: typeof payload?.id === "string" ? payload.id : undefined, data: { clickAction } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const clickAction = typeof event.notification.data?.clickAction === "string" ? event.notification.data.clickAction : "/";
  const target = new URL(clickAction, self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    return existing ? existing.navigate(target).then((client) => client?.focus()) : self.clients.openWindow(target);
  }));
});

function readPayload(event) {
  if (!event.data) return {};
  try { return JSON.parse(event.data.text()); } catch { return {}; }
}
