# Codex Control PWA

A mobile-first Codex control panel with generated app-server protocol artifacts, supervised JSONL/RPC transport, reconnectable browser WebSockets, configured projects, mobile thread control, timelines, approvals, read-only work review, integrations/status, notifications, PWA caching, and deployment assets.

```bash
corepack pnpm install
corepack pnpm generate:protocol
corepack pnpm test
corepack pnpm check
corepack pnpm build
corepack pnpm --filter @codex-control/server dev
```

The server binds to `127.0.0.1:3210` by default, serves the production PWA, and exposes `/healthz`, `/readyz`, `/api/system/status`, `/api/version`, `/api/projects`, and `/ws`. It intentionally contains no login, terminal, editor, filesystem-management, repository-search, or Git surface.
