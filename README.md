# Codex UI

Codex UI is a browser interface for the Codex app-server. The production image includes a pinned Codex CLI binary, so a host only needs Docker, a projects directory, and an existing Codex configuration directory.

## Run with Docker

Create a `.env` file from the example and set the two host directories plus the public domain:

```dotenv
PROJECTS_ROOT=/absolute/path/to/projects
HOST_CODEX_HOME=/home/your-user/.codex
HOST_UID=1000
HOST_GID=1000
PUBLIC_ORIGIN=https://codex.example.com
```

If unset, `HOST_CODEX_HOME` defaults to the host user's standard `.codex` directory. It retains Codex authentication, configuration, project registry data, and optional Web Push subscriptions. `PROJECTS_ROOT` is mounted at `/workspace` and is the only project directory exposed to the container.

Set `HOST_UID` and `HOST_GID` to `id -u` and `id -g` for the account that owns those directories (they are commonly both `1000`). This lets Codex UI use your mounted configuration without changing any host file ownership.

Start the service:

```bash
docker compose up -d --build
```

## Run the published image

After the Docker Hub workflow has published a version, run it without cloning the repository:

```bash
docker run -d --name codex-ui --restart unless-stopped \
  --user "$(id -u):$(id -g)" \
  -p 127.0.0.1:3210:3210 \
  -e PUBLIC_ORIGIN=https://codex.example.com \
  -e PROJECTS_ROOT=/workspace \
  -e CODEX_HOME=/home/app/.codex \
  -e CODEX_CWD=/workspace \
  -v /absolute/path/to/projects:/workspace \
  -v "$HOME/.codex:/home/app/.codex" \
  ivoglent/codex-ui:latest
```

Use a version tag such as `ivoglent/codex-ui:0.149.1` when you need a repeatable deployment. As with Compose, put the loopback port behind an authenticated TLS reverse proxy before exposing a domain.

The published port binds only to `127.0.0.1`; do not expose it directly. Codex UI has no built-in user authentication and can access the mounted projects and Codex credentials. Put it behind a TLS reverse proxy with authentication (for example, the Basic Auth configuration in `deploy/gateway/nginx.conf.example` or an identity-aware proxy) before using a public domain. For local testing, use `http://localhost:3210`. The container health endpoint is available at `/readyz`.

New turns default to a safe workspace sandbox and request approval before actions. Do not change the execution profile or project approval policy to unrestricted/auto-approve for an internet-facing deployment.

## Configuration

The image includes the Codex CLI version declared by `CODEX_VERSION` in the [Dockerfile](Dockerfile). The GitHub workflow publishes Docker Hub image tags matching that version at `ivoglent/codex-ui`, plus `latest`, after changes land on `master`. Add `DOCKERHUB_USERNAME` and a Docker Hub access-token `DOCKERHUB_TOKEN` as GitHub Actions secrets to enable publishing; without both secrets, CI still builds the image and skips publication.

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
