# Phase 0 architecture

The backend owns one long-lived `codex app-server --stdio` child process. `JsonlFramer` isolates newline framing and malformed-line recovery, `RpcBroker` owns monotonically increasing request IDs and pending calls, and `AppServerSupervisor` owns the initialize/initialized handshake, lifecycle, bounded restart policy, stderr redaction, and status snapshots.

Codex remains authoritative for threads, turns, and events. Unknown notifications and server-initiated requests are forwarded as raw method/params pairs. The backend does not expose filesystem, terminal, command-execution, search, or Git APIs.
