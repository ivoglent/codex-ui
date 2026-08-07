import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { AppServerSupervisor } from "./codex/supervisor.js";
import { readVersionStatus } from "./system/version.js";
import { ProjectRegistry } from "./config/projects.js";
import { BrowserHub } from "./websocket/hub.js";
import { createDeepLink } from "./deep-links/service.js";
import { handleProjectsApi } from "./http/projects-api.js";
import { handleModelPresetsApi } from "./http/model-presets-api.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3210);
const workspaceRoot = existsSync(join(process.cwd(), "config/projects.yaml")) ? process.cwd() : join(process.cwd(), "../..");
const supervisor = new AppServerSupervisor({ executable: process.env.CODEX_EXECUTABLE ?? "codex", args: process.env.CODEX_ARGS ? JSON.parse(process.env.CODEX_ARGS) as string[] : ["app-server", "--stdio"], cwd: process.env.CODEX_CWD ?? workspaceRoot });
const projects = await ProjectRegistry.load(process.env.PROJECTS_CONFIG ?? join(workspaceRoot, "config/projects.yaml"));
await supervisor.start();

const server = createServer(async (request, response) => {
  response.setHeader("x-content-type-options", "nosniff"); response.setHeader("referrer-policy", "no-referrer"); response.setHeader("x-frame-options", "DENY"); response.setHeader("content-security-policy", "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  response.setHeader("content-type", "application/json");
  if (request.url === "/healthz") return response.end(JSON.stringify({ ok: true }));
  if (request.url === "/readyz") { response.statusCode = supervisor.status.state === "READY" ? 200 : 503; return response.end(JSON.stringify(supervisor.status)); }
  if (request.url === "/api/system/status") return response.end(JSON.stringify({ appServer: supervisor.status, version: await readVersionStatus() }));
  if (request.url === "/api/version") return response.end(JSON.stringify(await readVersionStatus()));
  if (request.url === "/metrics") { response.setHeader("content-type", "text/plain; version=0.0.4"); return response.end(hub.metrics.render()); }
  if (await handleModelPresetsApi(request, response)) return;
  if (await handleProjectsApi(request, response, projects, process.env.PUBLIC_ORIGIN, () => hub.projectsChanged())) return;
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
const hub = new BrowserHub(server, supervisor, projects, undefined, process.env.PUBLIC_ORIGIN);
server.listen(port, host, () => process.stdout.write(`codex-control server listening on http://${host}:${port}\n`));
const shutdown = async () => { hub.close(); server.close(); await supervisor.stop(); };
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
