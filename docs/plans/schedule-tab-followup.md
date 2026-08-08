# Plan: Schedule Tab Follow-up Bugs

**Status:** Draft
**Target branch:** `feat/schedule-tab` (update existing PR #35)
**Delivery:** Same focused commit series into the same PR

## 1. Goal

Address four bugs found during live validation of the Schedule tab PR:

1. The schedule prompt and working directory are not editable in the form.
2. The one-shot `runAt` field should be replaced with a cron expression.
3. A web UI cannot see Codex sessions created in another web UI peer.
4. The chat timeline should expose the thread id so users can copy it and resume in a terminal.

## 2. Confirmed behavior

### 2.1 Editable prompt and working directory

- The `<textarea>` and `<input>` for prompt and `cwd` had their values bound to a writable signal but the signalled `form()` was passed by reference. The change handler kept writing back the same object — the dialog never reflected the user's keystrokes, and the saved value was the original.
- Fix by switching the form state to a signal with `update`, and explicitly using the latest form values when the user clicks Save. The form is rebuilt on every keystroke; the model selector uses a stable key (the catalog key, not the raw model name) so the `<select>` round-trips correctly.

### 2.2 Cron expression instead of `runAt`

- Replace `runAt: string` with `cron: string` (5-field cron syntax, timezone-aware on the server).
- Track `lastRunAt?: string` and `nextRunAt?: string` derived from the cron expression.
- The scheduler picks schedules whose `nextRunAt <= now` and `status === "pending"` (or `running` allowed to retry).
- After a successful run, the registry advances `status` back to `pending` and recomputes `nextRunAt` from the cron.
- The UI replaces the `datetime-local` input with a single text input + helper copy ("every 5 minutes", "0 9 * * 1", etc.).

### 2.3 Cross-UI session visibility

- Server maintains a per-`clientId` "active sessions" map populated from `thread/start` calls.
- Any `codex.event` notification includes the originating `@clientId` (forwarded by the supervisor; the hub adds it on broadcast).
- The web UI listens for these events and merges thread list deltas from the server. The thread selector shows threads owned by any active client, with a marker indicating which client created it.
- The Session option dialog gains a column for the owning client.

### 2.4 Copy thread id

- The session heading gains a small "copy thread id" button that puts the thread id on the clipboard.
- A small snackbar confirms the copy.

## 3. Architecture and contracts

### 3.1 Schedule model changes

- `ScheduleRecord`:
  - Drop `runAt`.
  - Add `cron: string`.
  - Add `nextRunAt?: string`.
  - `status` is reset to `pending` after a successful run so the cron can re-fire.
  - `lastRunAt?: string` is the last successful execution.

### 3.2 Cron validator

- New `apps/server/src/scheduler/cron.ts` exporting `parseCron(expr: string, now?: Date): { nextRunAt: Date } | null`.
- Reject expressions with seconds, years, or anything outside the 5-field POSIX form.
- Reject any expression that does not produce a `nextRunAt` within the next 5 years.

### 3.3 Scheduler

- Scheduler picks `dueBy(now)` from `registry.list().filter(s => s.status === "pending" && s.nextRunAt && Date.parse(s.nextRunAt) <= now)`.
- After a successful run, the registry's `runCompleted(scheduleId)` recomputes `nextRunAt` and resets `status` to `pending`.
- Missed window: if a schedule is more than 5 minutes past `nextRunAt` (because the app-server was offline), it is marked `failed` for that tick and will retry on the next cron evaluation.

### 3.4 Cross-UI session tracking

- `BrowserHub` advertises its `clientId` (already produced by `ConnectionService`) on every event.
- `attention.list()` is augmented with the originating `clientId` for each pending request.
- The web UI's `TimelineStore` / new `SessionsStore` listens for `codex.event` notifications and re-queries `thread/list` when a creation event arrives from a peer.

### 3.5 Copy thread id

- New `apps/web/src/app/clipboard.ts` (small utility wrapping `navigator.clipboard.writeText` with a fallback).
- A new button is added to the session heading. On click, it copies the thread id and surfaces a transient snackbar.

## 4. Risk Assessment

| # | Risk | Category | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| 1 | Cron parsing accepts ambiguous expressions | UX | Medium | Medium | Reject anything outside the 5-field POSIX form in both server validator and UI hint |
| 2 | Cron over-fires after long offline | Operational | Medium | Medium | Missed-window check (5 min) caps how many runs are skipped |
| 3 | Cross-UI marking causes the wrong client to own a session | UX | Low | Low | The originating client is stamped on the `codex.event`; the UI only uses it for display |
| 4 | Clipboard copy fails in non-secure contexts | UX | Low | Low | Fallback to a hidden `<textarea>` + `document.execCommand("copy")` |
| 5 | Existing persisted schedules are missing `cron` | Operational | High | High | Loader treats records without `cron` as failed and stops loading them; user re-creates |

## 5. Dependencies & Constraints

- The hub already broadcasts `codex.event` for every notification. Adding `clientId` is a server-side change.
- The scheduler already runs through the broker; reusing the same path keeps the safety posture.
- The `Socket` carries the `clientId` in the `system.snapshot` and `system.snapshot` already supports a `clientId` field; we just need to populate it.

## 6. Milestones

1. Cron parser + `validateCronInput` helpers + unit tests.
2. `ScheduleRegistry` migration: remove `runAt`, add `cron`/`nextRunAt`, ensure loader rejects broken records.
3. Scheduler advances `nextRunAt` and resets `status` after each run.
4. Schedule API switched to `cron`, update tests.
5. Schedule UI: replace datetime-local with cron text input + helper.
6. Cross-UI session tracking: stamp `clientId` on events, list in selector.
7. Copy thread id button + clipboard util + snackbar.
8. Update E2E / docs / plan, push, re-run CI.
