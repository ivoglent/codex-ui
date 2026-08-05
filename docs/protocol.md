# Codex protocol

Protocol artifacts are generated from the installed Codex CLI with `pnpm generate:protocol`. The exact CLI version and generation timestamp are recorded in `packages/codex-protocol/protocol-version.json`; `pnpm verify:protocol` fails when the installed version differs.

This spike opts into the experimental protocol so generated artifacts represent all capabilities available to diagnostics and future adapters. Product adapters must still allowlist user-facing methods and preserve the scope boundary.

Codex 0.146.0 requires `initialize` to complete before the `initialized` notification. Text inputs for `turn/start` include `text_elements: []`, as required by the generated schema.

The generated 0.146.0 schema uses approval values `untrusted`, `on-request`, granular policy, or `never`; the plan's older `unlessTrusted` spelling is not sent. Turn-level `workspaceWrite` also requires explicit writable-root and temporary-directory fields. Runtime payloads follow the generated schema.
