/*
 * Angular continues to own caching. This wrapper translates Notification Hub's
 * canonical payload ({ details: { title, message, clickAction } }) into a
 * visible browser notification for this PWA.
 */
importScripts("./ngsw-worker.js");

self.addEventListener("push", (event) => {
  const payload = readPayload(event);
  const details = payload && typeof payload.details === "object" ? payload.details : {};
  const title = typeof details.title === "string" && details.title ? details.title : "Codex Control";
  const body = typeof details.message === "string" ? details.message : "Codex needs your attention.";
  const clickAction = typeof details.clickAction === "string" ? details.clickAction : "/";
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
