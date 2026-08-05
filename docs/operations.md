# Operations

Build with `corepack pnpm build`, copy `config/projects.example.yaml` to `config/projects.yaml`, and adjust absolute roots and code-server URLs. Run the backend as the same non-root OS user as Codex and code-server.

Set `PUBLIC_ORIGIN` to the exact HTTPS PWA origin, `PROJECTS_CONFIG` to the project YAML, and optionally `WEB_ROOT` to the Angular browser build. `CODEX_EXECUTABLE`, `CODEX_ARGS` (a JSON string array), and `CODEX_CWD` override process launch details. The gateway must proxy HTTP and WebSocket upgrades and must be the only externally reachable listener.

Health probes are `/healthz` and `/readyz`. `/api/system/status` reports app-server generation, lifecycle, protocol errors, and version compatibility. `/metrics` contains content-free Prometheus metrics. After upgrading Codex, run `corepack pnpm generate:protocol`, review schema changes, and rerun all tests.

Back up only configuration files and browser-specific preferences as needed. Codex owns thread history under its normal configuration directory; this application creates no duplicate transcript database.
