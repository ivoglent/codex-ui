# Codex Control PWA

A mobile-first Codex control panel with generated app-server protocol artifacts, supervised JSONL or shared-daemon WebSocket RPC transport, reconnectable browser WebSockets, configured projects, mobile thread control, timelines, approvals, read-only work review, integrations/status, notifications, PWA caching, and deployment assets.

## Web Push

Web Push is optional and is delivered directly by this backend; no notification service is required. Generate a VAPID P-256 key pair with your preferred Web Push tooling, then set `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, and `WEB_PUSH_VAPID_SUBJECT` in the deployment environment. Keep the private key and the persisted subscription file out of source control.

## License

MIT. See [LICENSE](LICENSE).

```bash
corepack pnpm install
corepack pnpm generate:protocol
corepack pnpm test
corepack pnpm check
corepack pnpm build
corepack pnpm --filter @codex-control/server dev
```

The server binds to `127.0.0.1:3210` by default, serves the production PWA, and exposes `/healthz`, `/readyz`, `/api/system/status`, `/api/version`, `/api/projects`, `/api/model-presets`, `/api/schedules*`, and `/ws`. `POST /api/projects` accepts only a display name and creates one safe directory under the configured discovery root. The app intentionally contains no login, terminal, editor, general filesystem-management, repository-search, or Git surface.

## Shared Codex app-server

By default, the backend starts its own `codex app-server --stdio` child. That mode is useful for an isolated deployment, but a terminal connected to another app-server will not share live thread state with the UI.

To let the terminal and UI operate on the same Codex threads, run one app-server on the host with a Unix-socket listener and connect both clients to it:

```text
terminal ───────────────┐
                       ├── host codex app-server ── threads and turns
Codex UI ── proxy ─────┘
```

### 1. Start the host app-server

Create a private runtime directory owned by the account that runs Codex, then start the listener:

```bash
sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 700 /run/codex-app-server
codex app-server --listen unix:///run/codex-app-server/codex.sock
```

The socket should be accessible only to that user. For a durable deployment, run this command from the host service manager and ensure the runtime directory is recreated after reboot.

### 2. Connect the terminal

Start the terminal client against the same listener:

```bash
codex --remote unix:///run/codex-app-server/codex.sock
```

### 3. Connect Codex UI

Mount the socket directory into the container and configure the backend to launch Codex's byte-stream proxy:

```yaml
services:
  codex-ui:
    environment:
      HOME: "${HOST_HOME}"
      CODEX_HOME: "${HOST_HOME}/.codex"
      CODEX_CWD: "${PROJECTS_ROOT}"
      CODEX_EXECUTABLE: codex
      CODEX_ARGS: '["app-server","proxy","--sock","/run/codex-app-server/codex.sock"]'
    volumes:
      - "${PROJECTS_ROOT}:${PROJECTS_ROOT}"
      - "${HOST_HOME}/.codex:${HOST_HOME}/.codex"
      - /run/codex-app-server:/run/codex-app-server
```

Run the container with the same UID and GID as the host Codex account so it can open the mode-`0600` socket and read the mounted Codex configuration:

```yaml
user: "${HOST_UID:-1000}:${HOST_GID:-1000}"
```

The host and container Codex CLI versions should match. This repository's runtime image pins its CLI version with the Docker build argument `CODEX_VERSION`.

### Setup service 

/etc/systemd/system/codex-app-server.service;
```
[Unit]
Description=Shared Codex App Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=codex-control
Group=codex-control
WorkingDirectory=/opt/codex-control

Environment=HOME=/var/lib/codex-control
Environment=CODEX_HOME=/var/lib/codex-control/.codex
Environment=PATH=/usr/local/bin:/usr/bin

RuntimeDirectory=codex-app-server
RuntimeDirectoryMode=0770
UMask=0007

ExecStart=/usr/local/bin/codex app-server --listen unix:///run/codex-app-server/codex.sock

Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Ultils: 
start-codex
```
#!/usr/bin/env bash

exec codex --remote unix:///run/codex-app-server/codex.sock --cd "$PWD" "$@"
```

### Transport details

The two launch modes use different wire formats:

| Backend launch | Transport used by Codex UI |
| --- | --- |
| `codex app-server --stdio` | newline-delimited JSON-RPC |
| `codex app-server proxy --sock ...` | WebSocket HTTP upgrade and WebSocket text frames over the proxy byte stream |

The proxy does not translate JSONL into WebSocket frames. Codex UI detects `app-server proxy`, performs the WebSocket upgrade at `/rpc`, disables `permessage-deflate` for Codex CLI compatibility, and then sends one JSON-RPC message per text frame. Sending JSONL directly to the proxy causes `app-server initialization timed out` because the Unix listener is waiting for the WebSocket handshake.

### Branding a deployment

One deployment can be named for a person, team, project, or domain without rebuilding the web app. Set these server environment variables and restart the service:

```dotenv
APP_TITLE=Acme Delivery Hub
APP_SHORT_NAME=Acme
APP_ICON_URL=/assets/acme.svg
APP_THEME_COLOR=#123456
APP_BACKGROUND_COLOR=#0b1020
```

The title, header logo, PWA install manifest, browser update notifications, notification registration name, and server push text use this identity. `APP_ICON_URL` is deliberately limited to a same-origin absolute path without a query string; put custom icons in the built web assets (for example `apps/web/public/assets/acme.svg`) so the PWA and the content-security policy can load them safely. `PUBLIC_ORIGIN` remains the deployment's external domain setting.

Each client performs its own `initialize` handshake. Threads and turns live in the shared app-server; clients subscribe to a thread when they start or resume it. Consequently, open or resume the same thread in each surface when live turn/item notifications are required.

### Verify the shared deployment

Confirm the host listener and container mount before checking UI readiness:

```bash
ss -xlp | grep /run/codex-app-server/codex.sock
docker compose exec codex-ui test -S /run/codex-app-server/codex.sock
docker compose exec codex-ui codex --version
codex --version
curl -fsS http://localhost:3210/readyz
```

`/readyz` must return HTTP `200` with app-server state `READY`. If it remains unavailable:

- Confirm the host app-server is running before the container starts.
- Confirm the socket path is identical on the host and in `CODEX_ARGS`.
- Confirm the container UID/GID can access the socket directory and socket.
- Confirm both Codex binaries use compatible versions.
- Inspect `docker logs codex-ui` for startup and WebSocket upgrade failures. After startup, `/api/system/status` exposes the supervisor's redacted last error and protocol-error count.

Do not fall back to container-local `--stdio` when terminal/UI synchronization is required. That starts an independent app-server and produces separate live connection state.
