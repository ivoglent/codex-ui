import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { AppServerSupervisor } from "./codex/supervisor.js";
import { readVersionStatus } from "./system/version.js";
import { ProjectRegistry } from "./config/projects.js";
import { ScheduleRegistry } from "./config/schedules.js";
import { Scheduler } from "./scheduler/scheduler.js";
import { BrowserHub } from "./websocket/hub.js";
import { createDeepLink } from "./deep-links/service.js";
import { handleProjectsApi } from "./http/projects-api.js";
import { handleModelPresetsApi } from "./http/model-presets-api.js";
import { handleSchedulesApi } from "./http/schedules-api.js";
import { handleSessionsApi } from "./http/sessions-api.js";
import { notificationHubBrowserConfig } from "./notifications/browser-config.js";
import { accessTokenFromCookie, NotificationDispatcher } from "./notifications/dispatcher.js";
import { proxyNotificationHub } from "./notifications/hub-proxy.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3210);
const workspaceRoot = existsSync(join(process.cwd(), "config/projects.yaml")) ? process.cwd() : join(process.cwd(), "../..");
const supervisor = new AppServerSupervisor({ executable: process.env.CODEX_EXECUTABLE ?? "codex", args: process.env.CODEX_ARGS ? JSON.parse(process.env.CODEX_ARGS) as string[] : ["app-server", "--stdio"], cwd: process.env.CODEX_CWD ?? workspaceRoot });
const projects = await ProjectRegistry.load(process.env.PROJECTS_CONFIG ?? join(workspaceRoot, "config/projects.yaml"));
const schedules = await ScheduleRegistry.load({ safeRoot: process.env.PROJECTS_ROOT });
const notificationHub = notificationHubBrowserConfig(process.env);
let restartingForAppServerFailure = false;
supervisor.on("status", (status) => {
  // A bind-mounted Unix-socket directory can be replaced by the host service
  // after this container starts. The existing container then sees the old,
  // empty directory forever. Once the supervisor has exhausted its bounded
  // retries, exit so Docker's restart policy creates a fresh mount.
  if (status.state !== "FAILED" || restartingForAppServerFailure) return;
  restartingForAppServerFailure = true;
  process.stderr.write(`app-server entered FAILED state; exiting for container recovery: ${status.lastError ?? "unknown error"}\n`);
  setTimeout(() => process.exit(1), 50).unref();
});
await supervisor.start();

const server = createServer(async (request, response) => {
  response.setHeader("x-content-type-options", "nosniff"); response.setHeader("referrer-policy", "no-referrer"); response.setHeader("x-frame-options", "DENY"); response.setHeader("content-security-policy", `default-src 'self'; connect-src 'self' ws: wss:${notificationHub.cspConnectSource ? ` ${notificationHub.cspConnectSource}` : ""}; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`);
  response.setHeader("content-type", "application/json");
  if (request.url === "/healthz") return response.end(JSON.stringify({ ok: true }));
  if (request.url === "/readyz") { response.statusCode = supervisor.status.state === "READY" ? 200 : 503; return response.end(JSON.stringify(supervisor.status)); }
  if (request.url === "/api/system/status") return response.end(JSON.stringify({ appServer: supervisor.status, version: await readVersionStatus(), schedule: { safeRoot: schedules.safeRootPath } }));
  if (request.url === "/api/version") return response.end(JSON.stringify(await readVersionStatus()));
  if (request.url === "/api/notification-hub/config") return response.end(JSON.stringify(notificationHub.publicConfig));
  if (request.url === "/api/notification-hub/push/config" && request.method === "GET") return proxyHubRequest(request, response, "/api/v1/push/config");
  if (request.url === "/api/notification-hub/destinations/web-push" && request.method === "POST") return proxyHubRequest(request, response, "/api/v1/me/destinations/web-push");
  if (request.url === "/metrics") { response.setHeader("content-type", "text/plain; version=0.0.4"); return response.end(hub.metrics.render()); }
  if (await handleModelPresetsApi(request, response)) return;
  if (await handleProjectsApi(request, response, projects, process.env.PUBLIC_ORIGIN, () => hub.projectsChanged())) return;
  if (await handleSessionsApi(request, response, hub, process.env.PUBLIC_ORIGIN)) return;
  if (await handleSchedulesApi(request, response, { registry: schedules, publicOrigin: process.env.PUBLIC_ORIGIN, onChanged: (schedule) => hub.broadcastScheduleChange(schedule) })) return;
  if (request.url?.startsWith("/api/deep-link?")) {
    const url = new URL(request.url, `http://${host}`); const project = projects.get(url.searchParams.get("projectId") ?? "");
    if (!project) { response.statusCode = 404; return response.end(JSON.stringify({ error: "Unknown project" })); }
    try { return response.end(JSON.stringify({ url: await createDeepLink(project, url.searchParams.get("path") ?? undefined, Number(url.searchParams.get("line") ?? 1)) })); }
    catch (error) { response.statusCode = 400; return response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
  }
  if ((request.method === "GET" || request.method === "HEAD") && !request.url?.startsWith("/api/")) {
    const webRoot = process.env.WEB_ROOT ?? join(workspaceRoot, "apps/web/dist/browser");
    const requested = normalize((request.url ?? "/").split("?")[0]).replace(/^\.\.(\/|\\|$)/, "");
    let file = join(webRoot, requested === "/" ? "index.html" : requested);
    if (!file.startsWith(webRoot) || !existsSync(file) || statSync(file).isDirectory()) file = join(webRoot, "index.html");
    if (existsSync(file)) { const mime: Record<string,string> = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".json":"application/json", ".svg":"image/svg+xml", ".webmanifest":"application/manifest+json" }; response.setHeader("content-type", mime[extname(file)] ?? "application/octet-stream"); if (request.method === "HEAD") return response.end(); return createReadStream(file).pipe(response); }
  }
  response.statusCode = 404; response.end(JSON.stringify({ error: "Not found" }));
});
const dispatcher = notificationHub.publicConfig.enabled && notificationHub.publicConfig.baseUrl ? new NotificationDispatcher({ baseUrl: notificationHub.publicConfig.baseUrl, service: notificationHub.publicConfig.service }) : undefined;
const hub = new BrowserHub(server, supervisor, projects, undefined, process.env.PUBLIC_ORIGIN, 10_000, dispatcher);
const scheduler = new Scheduler({ registry: schedules, supervisor, broadcast: (schedule) => hub.broadcastScheduleChange(schedule) });
scheduler.start();
const projectRefresh = setInterval(() => {
  void projects.refreshDiscovered().then((changed) => {
    if (changed) hub.projectsChanged();
  }).catch((error) => process.stderr.write(`project discovery refresh failed: ${error instanceof Error ? error.message : String(error)}\n`));
}, 5_000);
server.listen(port, host, () => process.stdout.write(`codex-control server listening on http://${host}:${port}\n`));
const shutdown = async () => { clearInterval(projectRefresh); await scheduler.stop(); hub.close(); server.close(); await supervisor.stop(); };
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

async function proxyHubRequest(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse, path: string): Promise<void> {
  const baseUrl = notificationHub.publicConfig.baseUrl; const accessToken = accessTokenFromCookie(request.headers.cookie);
  if (!baseUrl) { response.statusCode = 503; response.end(JSON.stringify({ error: "Notification Hub is not configured" })); return; }
  if (!accessToken) { response.statusCode = 401; response.end(JSON.stringify({ error: "Authentication is required" })); return; }
  try {
    const body = request.method === "POST" ? await readJsonBody(request) : undefined;
    const upstream = await proxyNotificationHub(baseUrl, path, accessToken, request.method === "POST" ? "POST" : "GET", body);
    response.statusCode = upstream.status; if (upstream.contentType) response.setHeader("content-type", upstream.contentType); response.end(upstream.body);
  } catch (error) { response.statusCode = 502; response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Notification Hub is unavailable" })); }
}

async function readJsonBody(request: import("node:http").IncomingMessage): Promise<string> {
  let body = ""; for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 32_768) throw new Error("Notification subscription is too large"); }
  JSON.parse(body); return body;
}
