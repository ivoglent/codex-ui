# Plan: Schedule Tab (Replace Inbox)

**Status:** Approved, implemented on `feat/schedule-tab`
**Target branch:** New feature branch from current `origin/develop`
**Delivery:** One focused pull request into `develop`, opened only after the full test pipeline passes

## 1. Goal

Replace the unused **Inbox** tab with a **Schedule** tab that lets the user configure background Codex tasks. Each task stores a custom prompt, an optional model/provider pair, and a single fire time. The server runs due tasks through the existing `codex app-server` broker and reports status back to the UI in real time.

Schedules are **independent of registered projects**. Each task carries its own working directory (`cwd`), which the user provides and the server validates against a configured safe root.

## 2. Confirmed behavior

- The **Inbox** tab, its nav entry, its pending-counter badge, and the `inboxFailures` computed signal are removed from `apps/web/src/app/app.component.html` and `app.component.ts`. Approval handling stays in the chat flow via the existing `activeApproval` modal.
- The new tab is named **Schedule** with the icon `⏱`. The `PrimaryTab` union becomes `"chat" | "schedule" | "settings"`.
- Schedules are flat/global. There is no per-project grouping in storage or in the UI list.
- Each schedule entry contains:
  - `id` (UUID, server-assigned)
  - `cwd` (absolute path, validated against the safe root)
  - `prompt` (string, non-empty, max 8 KiB)
  - `modelKey` (optional, taken from the existing `modelOptions()` catalog)
  - `modelProvider` (optional, paired with `modelKey`)
  - `runAt` (ISO 8601 instant, must be in the future on create)
  - `status` (`pending | running | done | failed | cancelled`)
  - `createdAt`, `lastRunAt`, `lastError`
- **One-shot only** in v1. No recurring rules. The form exposes a single datetime-local input.
- The scheduler runs jobs through the existing broker. Each run calls `thread/start` (with model pair overrides) then `turn/start` (with the prompt). Each run creates a **new thread**; the schedule does not target an existing session.
- Approval requests raised by a scheduled run surface in the chat tab as today. No per-schedule approval policy is introduced; the existing safety posture (no auto-approval defaults) is preserved.
- If the app-server is not `READY` when a job is due, the job stays `pending` and is retried on the next tick after the supervisor reaches `READY`. If the job is older than 1 hour past `runAt`, it is marked `failed` and the user is informed through `lastError` ("missed window").
- The UI list and detail state update in real time via a new `schedule.changed` event on the existing `EventStream`.
- HTTP routes mirror the existing `projects-api.ts` patterns: small body cap, content-type/origin guards, JSON responses, standard error object shape.

## 3. Architecture and contracts

### 3.1 Storage

- New file `config/schedules.json` with version envelope `{ "version": 1, "schedules": Schedule[] }`.
- Loaded on startup by a new `ScheduleRegistry` (in `apps/server/src/config/schedules.ts`).
- Writes are atomic (write to `*.tmp` then `rename`) and serialized through a single internal queue to avoid interleaving.
- `cwd` validation rejects relative paths, traversal segments, and any path that does not resolve to a real directory inside the configured safe root. The safe root is the existing `PROJECTS_ROOT` environment variable, falling back to the same `config/projects.yaml` discovery root that the project registry uses.

### 3.2 Server component

- New `apps/server/src/scheduler/scheduler.ts` exporting a `Scheduler` class.
- Constructor takes `SchedulerOptions { registry, supervisor, tickMs?: 5_000, missWindowMs?: 3_600_000 }`.
- `start()` opens a `setInterval` that calls `pickDue()`. `pickDue()` selects entries with `status === "pending"` and `runAt <= now`, marks them `running`, and enqueues them through a per-cwd FIFO (one in-flight run per cwd; other cwds may run in parallel up to a small concurrency cap, default 4).
- `runNow(scheduleId)` bypasses the timer and triggers the same enqueue path.
- `cancel(scheduleId)` flips a `pending` entry to `cancelled`. Already-running entries are not aborted.
- Each run records `lastRunAt`, captures `thread.id` into a `runHistory` field on the schedule, and stores `turn.id` when the broker returns it.
- The dispatcher calls `supervisor.broker.request("thread/start", { cwd, model, modelProvider })` then `supervisor.broker.request("turn/start", { threadId, input: [{ type: "text", text: prompt }] })`.
- On error, status becomes `failed`, `lastError` is set to the broker error message, and `schedule.changed` is broadcast.
- The Scheduler subscribes to `supervisor.on("status", ...)` to learn when the app-server is ready and to flush any queued job.

### 3.3 HTTP API

`apps/server/src/http/schedules-api.ts` adds these routes. All return JSON. All enforce the same `origin`, `content-type`, and body size guards as `projects-api.ts`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/schedules` | List all schedules |
| `POST` | `/api/schedules` | Create a schedule |
| `PATCH` | `/api/schedules/:id` | Edit (`pending` only) — change `prompt`, `modelKey`, `modelProvider`, `runAt` |
| `DELETE` | `/api/schedules/:id` | Remove any schedule |
| `POST` | `/api/schedules/:id/run` | Run immediately (status resets to `pending` with `runAt = now`) |
| `POST` | `/api/schedules/:id/cancel` | Set `pending` → `cancelled` |

Create body:

```json
{
  "cwd": "/workspace/some-project",
  "prompt": "Summarize today's commits.",
  "modelKey": "gpt-5-codex",
  "modelProvider": "openai",
  "runAt": "2026-08-09T09:00:00.000Z"
}
```

`cwd` is required. `modelKey` and `modelProvider` are optional and must be supplied together. `runAt` must parse to a future ISO instant. The server stamps `id`, `status = "pending"`, and `createdAt`.

### 3.4 Realtime events

- `apps/server/src/websocket/hub.ts` already owns `EventStream`. Add `schedule.changed` with payload `{ schedule }` (full record) on every state mutation from the registry or the scheduler.
- The browser `ConnectionService` already accepts arbitrary events through `accept(message)` and pushes them into `events()`. The new `ScheduleStore` listens for `schedule.changed` and replaces its records.

### 3.5 Frontend

- New `apps/web/src/app/schedule.store.ts` (signal-based, `providedIn: "root"`, mirrors `DraftStore` style). Exposes `schedules()`, `byStatus(status)`, and request methods that call `fetch` on the new endpoints.
- New `apps/web/src/app/schedule.component.ts` (standalone, `templateUrl`/`styleUrl` siblings) owning the page, header, list, and form. It is rendered when `tab() === "schedule"`.
- Page layout:
  - Header `<h1>Schedule</h1>` with a `+` action that opens a form dialog.
  - List grouped by `pending` (sorted by `runAt` ascending), then `running`, then a collapsible **History** section listing `done`, `failed`, and `cancelled`.
  - Each row shows `runAt`, the resolved model label, the first 80 chars of the prompt, and a status pill. Actions: `Run now`, `Cancel`, `Delete`, and `Edit` (only when `pending`).
  - Form dialog: prompt textarea, model `<select>` populated from `modelOptions()` (with `ChatGPT (default)` blank option), datetime-local input, `cwd` text input. Save validates non-empty future instant and shows inline errors.
  - Empty state: `No scheduled tasks. Tap + to add one.`
- Add a small explanatory `<small>` under the datetime input: `Runs once at the chosen local time. The server uses UTC.`

### 3.6 Bootstrap wiring

- `apps/server/src/main.ts` instantiates `ScheduleRegistry`, `Scheduler`, and wires the new HTTP handler before `server.listen(...)`. The Scheduler is started after `supervisor.start()` resolves.
- When the scheduler mutates state, it calls `hub.broadcast(this.stream.append("schedule.changed", { schedule }))`. To avoid a circular import, the Scheduler takes a `broadcast: (event: unknown) => void` callback supplied by `main.ts`.

## 4. Risk Assessment

| # | Risk | Category | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| 1 | Path traversal or symlink escape through `cwd` | Security | Medium | High | Validate against configured safe root; `realpath` check; reject if outside root |
| 2 | Scheduler runs while app-server is not ready | Operational | Medium | High | Honor supervisor status; retry on reconnect; mark stale jobs `failed` after miss window |
| 3 | Concurrent edits to `schedules.json` | Operational | Medium | High | Serialize writes through a single internal queue; atomic rename |
| 4 | Job takes longer than the next tick | Operational | Medium | Low | Per-cwd FIFO + bounded concurrency; tick does not duplicate in-flight jobs |
| 5 | Bad model/provider pair supplied by the user | Technical | Medium | High | Validator requires both fields together; reject unknown keys against `modelOptions()` |
| 6 | App-server returns a long error string | UX | Low | Low | Persist only the first 512 characters of `lastError` |
| 7 | UI shows stale data after a realtime event drop | Technical | Low | Medium | Re-fetch list on reconnect via `system.snapshot` |
| 8 | User edits a running schedule | UX | Low | Low | `PATCH` is rejected unless `status === "pending"` |
| 9 | `runAt` in the past at create time | UX | Medium | Medium | Server rejects; UI shows server error inline |
| 10 | Datetime-local timezone confusion | UX | High | Low | Convert to UTC server-side; show resolved instant preview in the form |

## 5. Dependencies & Constraints

- Codex app-server methods used: `thread/start`, `turn/start`. Both are already in the `hub.ts` `allowedMethods` allowlist.
- The existing `ConnectionService.events()` and `EventStream` already carry arbitrary `codex.event` messages; the new `schedule.changed` reuses the same channel.
- The repository's existing model catalog (`modelOptions()` from `model-presets-api.ts` + `model/list`) is the only source of truth for selectable model pairs.
- The existing `PROJECTS_ROOT` env var (or `config/projects.yaml` discovery root) is the safe root.
- Notifications remain in the chat flow; the new tab does not introduce an additional notification channel.

## 6. Milestones & Timeline

1. `ScheduleRegistry` + `config/schedules.json` with unit tests for validation and persistence.
2. `Scheduler` with unit tests for pick/transition logic, miss window, and concurrency.
3. HTTP `/api/schedules*` routes with unit tests for validation and origin/content-type guards.
4. Realtime `schedule.changed` from `hub.ts` and a smoke test verifying broadcast.
5. `ScheduleStore` and `ScheduleComponent` with the create/edit/list/delete flow.
6. Wire `main.ts` boot order and a desktop/mobile Playwright pass at 390x844.
7. Update `docs/architecture.md`, `docs/implementation-status.md`, and `README.md` API list.

## 7. Resolved Items

- `cwd` safe root: **reuse `PROJECTS_ROOT`** (confirmed).
- Per-cwd concurrency cap: **4** (confirmed).
- Miss window: **1 hour** (confirmed).
