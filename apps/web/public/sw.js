/*
 * Angular continues to own caching. This wrapper translates Notification Hub's
 * canonical payload ({ details: { title, message, clickAction } }) into a
 * visible browser notification for this PWA.
 */
importScripts("./ngsw-worker.js");

self.addEventListener("push", (event) => {
  const payload = readPayload(event);
  const details = payload && typeof payload.details === "object" ? payload.details : {};
  // Angular's worker renders payloads with a top-level `notification` field.
  // Only own Notification Hub's canonical `details` payload here; otherwise a
  // single provider delivery is displayed twice (once by Angular and once by us).
  if (typeof details.title !== "string" || !details.title) return;
  const title = details.title;
  const body = typeof details.message === "string" ? details.message : "";
  const clickAction = typeof details.clickAction === "string" ? details.clickAction : "/";
  event.waitUntil(self.registration.showNotification(title, { body, tag: typeof payload?.id === "string" ? payload.id : undefined, data: { clickAction } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const clickAction = typeof event.notification.data?.clickAction === "string" ? event.notification.data.clickAction : "/";
  const target = new URL(clickAction, self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => client.url === target);
    return existing ? existing.focus() : self.clients.openWindow(target);
  }));
});

function readPayload(event) {
  if (!event.data) return {};
  try { return JSON.parse(event.data.text()); } catch { return {}; }
}
