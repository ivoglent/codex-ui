FROM node:20-bookworm AS builder

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/codex-protocol/package.json packages/codex-protocol/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

COPY . .
# Forwarded by the release workflow so the web bundle bakes the build version
# into its generated module and the server can report it from /api/version.
ARG APP_VERSION=0.0.0-dev
ARG APP_COMMIT=""
ENV APP_VERSION=${APP_VERSION} \
    APP_COMMIT=${APP_COMMIT}

RUN pnpm build && \
    pnpm --filter @codex-control/server deploy --prod /runtime

FROM node:20-bookworm-slim AS runtime

ARG CODEX_VERSION=0.146.0

RUN apt-get update && \
    apt-get install --yes --no-install-recommends ca-certificates curl && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    npm install --global "@openai/codex@${CODEX_VERSION}" && \
    npm cache clean --force && \
    groupadd --gid 10001 app && \
    useradd --uid 10001 --gid app --create-home --shell /usr/sbin/nologin app && \
    mkdir -p /app/apps/web/dist /app/config /home/app/.codex /workspace && \
    chown -R app:app /app /home/app/.codex /workspace

WORKDIR /app
COPY --from=builder --chown=app:app /runtime/ /app/server/
COPY --from=builder --chown=app:app /workspace/apps/web/dist/browser/ /app/apps/web/dist/browser/
COPY --chown=app:app config/projects.container.yaml /app/config/projects.yaml

# The release workflow forwards APP_VERSION and APP_COMMIT to both stages so
# the runtime image exposes the same build identity that /api/version reports.
ARG APP_VERSION=0.0.0-dev
ARG APP_COMMIT=""

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3210 \
    CODEX_HOME=/home/app/.codex \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    CODEX_CWD=/workspace \
    PROJECTS_ROOT=/workspace \
    CODE_SERVER_BASE_URL=http://localhost:8443 \
    APP_VERSION=${APP_VERSION} \
    APP_COMMIT=${APP_COMMIT}

USER app
EXPOSE 3210
HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3210/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["node", "/app/server/dist/src/main.js"]
