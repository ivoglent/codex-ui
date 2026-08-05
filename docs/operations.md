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

The container mounts `PROJECTS_ROOT` at the identical absolute path, scans for `.git` markers to a bounded depth, and generates code-server links by adding `?folder=<absolute-project-path>` to `CODE_SERVER_BASE_URL`. Native Codex credentials and configuration are reused from `HOST_HOME/.codex`.

`config/projects.container.yaml` defines the trusted discovery roots, scan depth, marker names, generated-link base URL, and defaults. Full `projects` entries are optional and override discovery when their resolved root matches a discovered repository.

## Runtime settings

Set `PUBLIC_ORIGIN` to the exact HTTPS PWA origin and `PROJECTS_CONFIG` to the project YAML. `CODEX_EXECUTABLE`, `CODEX_ARGS` (a JSON string array), and `CODEX_CWD` override process launch details. The gateway must proxy HTTP and WebSocket upgrades and must be the only externally reachable listener.

Health probes are `/healthz` and `/readyz`. `/api/system/status` reports app-server generation, lifecycle, protocol errors, and version compatibility. `/metrics` contains content-free Prometheus metrics. After upgrading Codex, run `corepack pnpm generate:protocol`, review schema changes, and rerun all tests.

Back up configuration files and browser-specific preferences as needed. Codex owns thread history under its normal configuration directory; this application creates no duplicate transcript database.
