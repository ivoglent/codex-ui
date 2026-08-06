# Codex Control PWA

A mobile-first Codex control panel with generated app-server protocol artifacts, supervised JSONL or shared-daemon WebSocket RPC transport, reconnectable browser WebSockets, configured projects, mobile thread control, timelines, approvals, read-only work review, integrations/status, notifications, PWA caching, and deployment assets.

```bash
corepack pnpm install
corepack pnpm generate:protocol
corepack pnpm test
corepack pnpm check
corepack pnpm build
corepack pnpm --filter @codex-control/server dev
```

The server binds to `127.0.0.1:3210` by default, serves the production PWA, and exposes `/healthz`, `/readyz`, `/api/system/status`, `/api/version`, `/api/projects`, and `/ws`. It intentionally contains no login, terminal, editor, filesystem-management, repository-search, or Git surface.

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

### Transport details

The two launch modes use different wire formats:

| Backend launch | Transport used by Codex UI |
| --- | --- |
| `codex app-server --stdio` | newline-delimited JSON-RPC |
| `codex app-server proxy --sock ...` | WebSocket HTTP upgrade and WebSocket text frames over the proxy byte stream |

The proxy does not translate JSONL into WebSocket frames. Codex UI detects `app-server proxy`, performs the WebSocket upgrade at `/rpc`, disables `permessage-deflate` for Codex CLI compatibility, and then sends one JSON-RPC message per text frame. Sending JSONL directly to the proxy causes `app-server initialization timed out` because the Unix listener is waiting for the WebSocket handshake.

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
