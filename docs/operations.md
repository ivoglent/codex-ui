# Operations

## Docker Compose with native code-server

Codex UI runs in Docker while code-server remains installed on the host. Both must use the same absolute project paths so a path selected by Codex is also valid in native code-server.

Copy `.env.example` to `.env`, then set:

- `HOST_UID` and `HOST_GID` from `id -u` and `id -g`.
- `HOST_HOME` to the native user's home containing `.codex`.
- `PROJECTS_ROOT` to the parent directory containing repositories.
- `CODE_SERVER_BASE_URL` to the browser-reachable native code-server origin.
- `PUBLIC_ORIGIN` to the exact browser origin for Codex UI.

Start and validate the service:

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
curl http://localhost:3210/healthz
curl http://localhost:3210/readyz
```

The container mounts `PROJECTS_ROOT` at the identical absolute path, scans for `.git` markers to a bounded depth, and generates code-server links by adding `?folder=<absolute-project-path>` to `CODE_SERVER_BASE_URL`. Native Codex credentials and configuration are reused from `HOST_HOME/.codex`. Discovery runs at startup and refreshes every five seconds, so a newly created or cloned repository appears in the project selector without restarting the container.

Projects created from the UI are direct children of the single configured discovery root. Their minimal registration records are written atomically to `${CODEX_HOME}/codex-ui/projects.json`; the project defaults and code-server URL continue to come from `config/projects.container.yaml`. `CODEX_UI_PROJECTS_FILE` may override the registration path for isolated testing or a custom deployment layout. The service user must be able to write both the discovery root and the registration directory.

`config/projects.container.yaml` defines the trusted discovery roots, scan depth, marker names, generated-link base URL, and defaults. Full `projects` entries are optional and override discovery when their resolved root matches a discovered repository.

## Runtime settings

Set `PUBLIC_ORIGIN` to the exact HTTPS PWA origin and `PROJECTS_CONFIG` to the project YAML. `CODEX_EXECUTABLE`, `CODEX_ARGS` (a JSON string array), and `CODEX_CWD` override process launch details. The gateway must proxy HTTP and WebSocket upgrades and must be the only externally reachable listener.

To enable Codex attention push, set `NOTIFICATION_HUB_PUBLIC_URL` to the browser-reachable, Gateway-proxied Notification Hub origin and optionally set `NOTIFICATION_HUB_SERVICE` (defaults to `codex-control`). The browser fetches the VAPID public key, registers its subscription at `/api/v1/me/destinations/web-push`, and publishes attention through `/api/v1/notifications/publish`. It sends no user ID or Hub token: Gateway derives and forwards the current authenticated user identity. `sw.js` imports Angular's cache worker and renders Notification Hub's delivered title/message payload as a browser notification.

Health probes are `/healthz` and `/readyz`. `/api/system/status` reports app-server generation, lifecycle, protocol errors, and version compatibility. `/metrics` contains content-free Prometheus metrics. After upgrading Codex, run `corepack pnpm generate:protocol`, review schema changes, and rerun all tests.

Back up configuration files, `${CODEX_HOME}/codex-ui/projects.json`, and browser-specific preferences as needed. Codex owns thread history under its normal configuration directory; this application creates no duplicate transcript database.
