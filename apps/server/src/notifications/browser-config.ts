export interface NotificationHubBrowserConfig {
  publicConfig: { enabled: boolean; baseUrl: string | null; service: string };
  cspConnectSource: string | null;
}

/**
 * Only public routing information may reach the browser. Authentication stays
 * in the Gateway cookie, which Notification Hub converts to its trusted
 * X-User-* identity headers.
 */
export function notificationHubBrowserConfig(env: NodeJS.ProcessEnv): NotificationHubBrowserConfig {
  const configured = env.NOTIFICATION_HUB_PUBLIC_URL?.trim();
  const service = env.NOTIFICATION_HUB_SERVICE?.trim() || "codex-control";
  if (!configured) return { publicConfig: { enabled: false, baseUrl: null, service }, cspConnectSource: null };
  let url: URL;
  try { url = new URL(configured); } catch { throw new Error("NOTIFICATION_HUB_PUBLIC_URL must be an absolute http(s) URL"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("NOTIFICATION_HUB_PUBLIC_URL must use http or https");
  const baseUrl = configured.replace(/\/+$/, "");
  return { publicConfig: { enabled: true, baseUrl, service }, cspConnectSource: url.origin };
}
