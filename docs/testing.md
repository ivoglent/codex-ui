# Testing

- `corepack pnpm test` runs deterministic JSONL, broker, and fake app-server integration tests.
- `corepack pnpm check` type-checks every workspace package.
- `corepack pnpm build` produces the production TypeScript build.
- `corepack pnpm smoke:fake` proves the Phase 0 RPC sequence against the fake app-server.
- `corepack pnpm smoke:real` uses a temporary cwd and the installed/authenticated Codex CLI. It creates an ephemeral thread and starts a harmless turn.
- `corepack pnpm test:e2e` runs the PWA boundary and reconnect suite under iPhone, Android, tablet, and desktop Chromium profiles. Install Playwright Chromium and its OS dependencies first. On this development host, `libasound2` was extracted into a temporary library directory because system package installation requires administrator access.

The real smoke test is intentionally separate because it needs an installed, authenticated Codex and consumes account capacity.
