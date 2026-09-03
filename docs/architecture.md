# Phase 0 architecture

The backend owns one long-lived `codex app-server --stdio` child process. `JsonlFramer` isolates newline framing and malformed-line recovery, `RpcBroker` owns monotonically increasing request IDs and pending calls, and `AppServerSupervisor` owns the initialize/initialized handshake, lifecycle, bounded restart policy, stderr redaction, and status snapshots.

Codex remains authoritative for threads, turns, and events. Unknown notifications and server-initiated requests are forwarded as raw method/params pairs. The backend does not expose filesystem, terminal, command-execution, search, or Git APIs.

## Phase 6 — Scheduled tasks

The server adds a `ScheduleRegistry` and a `Scheduler`. The `Scheduler` runs pending entries from the registry on a tick (default 5s) by calling `thread/start` then `turn/start` on the existing Codex broker. Each entry is independent of registered projects; it carries its own `cwd`, which is validated against the configured `PROJECTS_ROOT`. Entries are persisted in `config/schedules.json` and broadcast over the existing `EventStream` whenever their state changes.
