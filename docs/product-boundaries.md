# Product boundaries

The browser RPC adapter uses an explicit allowlist. It does not expose Codex standalone command/process methods, filesystem read/write/watch methods, terminal methods, repository search, or Git operations. Project roots come only from server YAML. Read-only file deep links resolve real paths and reject traversal or symlink escape.

There is intentionally no application authentication. The server binds to loopback by default and must remain behind the trusted HTTPS gateway.
