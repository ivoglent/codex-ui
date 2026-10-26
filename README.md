# Codex UI

Codex UI is a browser interface for the Codex app-server. The production image includes a pinned Codex CLI binary, so a host only needs Docker, a projects directory, and an existing Codex configuration directory.

## Run with Docker

Create a `.env` file from the example and set the two host directories plus the public domain:

```dotenv
PROJECTS_ROOT=/absolute/path/to/projects
HOST_CODEX_HOME=/home/your-user/.codex
PUBLIC_ORIGIN=https://codex.example.com
```

If unset, `HOST_CODEX_HOME` defaults to the host user's standard `.codex` directory. It retains Codex authentication, configuration, project registry data, and optional Web Push subscriptions. `PROJECTS_ROOT` is mounted at `/workspace` and is the only project directory exposed to the container.

Start the service:

```bash
docker compose up -d --build
```

Open `PUBLIC_ORIGIN` through a TLS reverse proxy that forwards traffic to port `3210`. For local testing, use `http://localhost:3210`. The container health endpoint is available at `/readyz`.

## Configuration

The image includes the Codex CLI version declared by `CODEX_VERSION` in the [Dockerfile](Dockerfile). The GitHub workflow publishes Docker Hub image tags matching that version at `ivoglent/codex-ui`, plus `latest`, after changes land on `master`.

Projects can be declared in `config/projects.container.yaml` or automatically discovered beneath `PROJECTS_ROOT`. The application only creates new project directories below the configured discovery root.

Set the optional branding variables in `.env` to name a deployment:

```dotenv
APP_TITLE=Codex UI
APP_SHORT_NAME=Codex
APP_ICON_URL=/favicon.svg
APP_THEME_COLOR=#111827
APP_BACKGROUND_COLOR=#090d16
```

Web Push is optional and delivered directly by this backend. To enable it, set `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, and `WEB_PUSH_VAPID_SUBJECT`. Keep the private key out of source control.

## Development

```bash
corepack pnpm install
corepack pnpm generate:protocol
corepack pnpm test
corepack pnpm check
corepack pnpm build
```

The server listens on `127.0.0.1:3210` by default. It exposes `/healthz`, `/readyz`, `/api/projects`, `/api/version`, and `/ws`.

## License

MIT. See [LICENSE](LICENSE).
