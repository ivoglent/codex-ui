# Technical Implementation Plan — Codex Control PWA

**Status:** Implementation-ready  
**Product type:** Lightweight mobile control panel for Codex  
**Target:** Internal tool behind an existing HTTPS gateway  
**Primary runtime:** Linux, using the same OS user and Codex configuration as `code-server`  
**Frontend:** Angular PWA, mobile-first  
**Backend:** Node.js + TypeScript  
**Codex integration:** `codex app-server` over JSONL/stdin/stdout  
**Application authentication:** None  
**Protocol baseline reviewed:** 2026-08-05

---

## 1. Product goal

Build an installable, mobile-first PWA for monitoring and controlling Codex running on a Linux development machine.

The PWA is **not an IDE** and must not replicate features already provided by `code-server`. Editing source code, browsing the complete workspace, using an interactive shell, running arbitrary commands manually, performing Git operations, debugging, and extension hosting remain the responsibility of `code-server`.

The PWA must make the common Codex workflow comfortable on a phone:

- Browse configured projects and their Codex threads.
- Start, resume, steer, interrupt, fork, rename, pin, archive, compact, and delete threads.
- Send prompts and follow multiple Codex turns in real time.
- Review plans, reasoning summaries, agent messages, commands, test output, file changes, diffs, reviews, tool calls, warnings, and errors.
- Approve, reject, or answer Codex requests without returning to `code-server`.
- View whether each thread is running, idle, waiting for approval, completed, interrupted, or failed.
- Configure thread-level model, reasoning effort, sandbox policy, approval policy, and other execution options supported by the installed Codex version.
- View context usage, rate limits, model rerouting, and Codex account status when available.
- Receive visible notifications when a thread requires attention or completes.
- Recover correctly after browser suspension, network changes, backend restart, or `codex app-server` restart.
- Preserve drafts, selected project, selected thread, and relevant UI state across reloads.
- Open the corresponding project or referenced file in `code-server` when full editing, terminal, Git, or debugging capabilities are required.

The PWA may display files, patches, command output, and repository information produced by Codex, but these are **read-only representations for review**. It must not implement a general-purpose code editor, file manager, terminal emulator, repository search interface, or Git client.

Support for multiple connected browser clients is optional as a product feature. The backend must remain consistent if more than one client connects, but collaborative multi-client operation is not a primary goal.

---

## 2. Product boundaries

## 2.1 Core responsibility

The PWA owns:

- Codex process supervision.
- Codex protocol communication.
- Thread and turn control.
- Real-time event presentation.
- Approval and user-input handling.
- Read-only diff, command output, review, and tool-call presentation.
- Mobile notifications and attention states.
- Reconnection and state recovery.
- Lightweight configuration of Codex execution settings.
- Deep links back to `code-server`.

## 2.2 Responsibilities retained by code-server

The following must remain outside this project:

- Editing source files.
- Browsing arbitrary directories.
- Searching repository contents.
- Interactive terminal access.
- Manually running shell commands.
- Git status, stage, commit, branch, pull, push, rebase, or conflict resolution.
- Debugger and breakpoints.
- Language server hosting and diagnostics.
- Extension management.
- File upload/download for workspace manipulation.
- Full desktop IDE layout.

## 2.3 Scope guard

When evaluating a proposed feature, use this rule:

> If the feature helps the user monitor, direct, approve, or understand Codex, it belongs in the PWA. If it lets the user directly perform coding or repository operations that code-server already handles, it does not belong in the PWA.

---

## 3. Confirmed decisions

### 3.1 No application login

Do not implement:

- Login page.
- User accounts.
- JWT.
- Identity cookies or sessions.
- OAuth for access to the PWA.
- Roles or permissions.
- Password reset.
- API keys for PWA access.

The existing gateway is the trust boundary.

This decision applies only to access to this application. Codex may still use its existing ChatGPT or API authentication stored under the Linux user's Codex configuration.

### 3.2 Native Linux deployment

Run the backend directly on Linux under the **same OS user that runs Codex and code-server**.

Do not use Docker for the first implementation unless a later operational requirement justifies it. Native deployment avoids unnecessary complications around:

- Access to `~/.codex`.
- Project working directories.
- Codex sandbox behavior.
- Local MCP processes and tools.
- File ownership.
- Existing Git and SSH configuration used internally by Codex.

The PWA itself does not expose Git or shell controls, but Codex must still run in the same environment as it does from code-server.

### 3.3 Backend owns the app-server process

The Node.js backend starts and supervises:

```bash
codex app-server --stdio
```

Use stdio/JSONL as the primary integration transport.

Do not connect the browser directly to `codex app-server`.

Do not use Codex's TCP WebSocket transport as the main architecture. The Node backend is still required for:

- Process supervision.
- Browser WebSocket fan-out.
- Reconnection and replay.
- UI-oriented state snapshots.
- Project mapping.
- Notifications.
- Compatibility adaptation.
- Diagnostics and redaction.

### 3.4 One long-lived app-server per backend instance

Use one long-lived `codex app-server` process for all configured projects and threads.

Reasons:

- Codex already models concurrency through threads and turns.
- Account state, model catalog, skills, MCP state, apps, and config are shared.
- Thread history is persisted by Codex and can be resumed after process restart.
- One broker is simpler to supervise, test, and recover.

Do not start one app-server per browser tab, project, or thread.

### 3.5 Generate protocol types from the installed Codex version

The app-server protocol can change. Do not manually recreate the full protocol as handwritten TypeScript interfaces.

Provide scripts equivalent to:

```bash
codex app-server generate-ts --out packages/codex-protocol/generated
codex app-server generate-json-schema --out packages/codex-protocol/schema
```

The generated output must correspond to the installed Codex CLI version.

At backend startup:

1. Read `codex --version`.
2. Compare it with the version recorded during protocol generation.
3. Show a visible warning when versions differ.
4. Preserve a raw compatibility path for unknown notifications, requests, fields, and item types.
5. Never crash the frontend because a new optional field or event type appears.

### 3.6 Read-only review surface

The PWA may render:

- File paths.
- File-change summaries.
- Unified or side-by-side patches.
- Command and test output.
- Review findings.
- Tool arguments and results where safe.
- Links that open the relevant project or file in code-server.

The PWA must not:

- Save file contents.
- Create or delete files.
- Execute standalone commands.
- Change Git state.
- Apply patches directly outside Codex's own approval flow.

---

## 4. Scope

## 4.1 In scope

### Codex lifecycle

- Detect Codex CLI availability and version.
- Start, stop, restart, and supervise `codex app-server`.
- Complete the initialize/initialized handshake.
- Expose backend and app-server health.
- Surface app-server stderr and startup errors safely.
- Restart automatically with bounded exponential backoff.
- Rehydrate browser clients after restart.
- Display protocol compatibility status.

### Projects

Projects are lightweight server-side mappings, not repository management objects.

Support:

- List configured projects.
- Display project name and root path.
- Store the project's code-server URL.
- Store per-project Codex defaults.
- Start a Codex thread with the project's root as cwd.
- Filter threads by project/cwd.
- Display recent Codex activity.
- Open the project in code-server.

Do not query Git solely to decorate the project list.

Example project metadata:

```yaml
projects:
  - id: quant-trading
    name: Quant Trading System
    root: /workspace/quant-trading-system
    codeServerUrl: https://code.example.com/?folder=/workspace/quant-trading-system
```

### Threads and turns

Support:

- List and search threads.
- Pagination and lazy history loading.
- Filter by project, status, pinned state, archived state, and source where supported.
- Start a thread.
- Read and resume a thread.
- Fork a thread.
- Rename a thread.
- Set, read, and clear a thread goal where supported.
- Pin and unpin.
- Archive and unarchive.
- Compact context.
- Unsubscribe when supported.
- Delete with explicit confirmation.
- Display parent/child relationships where available.
- Start turns with supported input types:
  - Text.
  - Image attachment.
  - Local image reference when supported.
  - File mention.
  - Skill mention.
  - App mention.
- Steer an active turn.
- Interrupt an active turn.
- Retry by creating a new turn or forking from a selected point.
- Follow several active threads concurrently.

### Codex timeline

Render all known item types relevant to coding, including:

- User message.
- Agent message.
- Plan.
- Reasoning summary.
- Command execution.
- File change.
- MCP tool call.
- Dynamic tool call.
- Collaboration or sub-agent call.
- Web search.
- Image view.
- Review start and completion.
- Context compaction.
- Warning.
- Error.
- Unknown future item through a generic detail card.

Handle lifecycle and delta events correctly:

- Item started.
- Item delta.
- Item completed.
- Turn started.
- Turn plan updated.
- Turn diff updated.
- Turn completed, interrupted, or failed.
- Token usage updated.
- Thread status updated.
- Hook started and completed.
- Model rerouted.
- Safety or rate-limit notice.

`item/completed` is the authoritative final representation of an item.

### Command and test output

Commands are initiated by Codex, not by a standalone PWA terminal.

The UI must:

- Show command line, cwd, purpose, and approval state.
- Stream stdout/stderr in order.
- Show running, completed, interrupted, timed-out, or failed status.
- Show exit code when available.
- Collapse very long output.
- Search within already displayed output.
- Copy command or selected output.
- Download or export raw output only if it already exists in the Codex event payload.
- Link back to the thread and project in code-server.

The UI must not accept arbitrary shell input.

### Approvals and questions

Support every server-initiated request required for the coding workflow, including:

- Command execution approval.
- File change approval.
- Network-specific approval.
- Filesystem/network permission request.
- Tool `requestUserInput`.
- MCP elicitation form.
- MCP URL confirmation.
- Dynamic tool call response.
- App or MCP side-effect confirmation.
- Generic fallback renderer for an unknown server request.

Support decisions exposed by the installed protocol, such as:

- Accept.
- Accept for session.
- Decline.
- Cancel.
- Accept with exec-policy amendment when supported.

Approval cards must show enough context for a safe decision:

- Project and thread.
- Exact command or affected files.
- cwd.
- Reason.
- Requested network destination.
- Requested permission roots.
- Diff preview for file changes.
- Whether another client already resolved it.

The PWA must never silently approve a request.

### Diff and review

Provide a read-only review experience:

- Live aggregated turn diff.
- Per-file changes.
- Unified diff mode.
- Side-by-side diff mode where screen width allows.
- Syntax highlighting.
- Added and deleted line counters.
- File list and jump navigation.
- Collapse unchanged sections.
- Copy file path, selected diff, or complete patch.
- Open referenced file/project in code-server.
- Review uncommitted changes through Codex.
- Review against a base branch through Codex.
- Review a commit through Codex.
- Run a custom review through Codex.
- Support inline or detached review delivery.
- Display review findings separately from normal chat.

The PWA must not directly apply, revert, stage, or commit changes.

### Plans and task progress

Provide a dedicated plan view:

- Current plan.
- Step status.
- Step transitions.
- Active step.
- Completed and failed steps.
- Plan changes over time.
- Jump from a plan step to related timeline items when identifiers are available.

A compact plan summary should remain visible while a turn is active.

### Models and execution settings

Support settings provided by the installed Codex protocol:

- Model catalog.
- Reasoning effort.
- Summary mode.
- Personality when supported.
- Collaboration mode when supported.
- Permission profile when supported.
- Sandbox policy presets.
- Approval policy presets.
- Network access within sandbox policy.
- Per-project defaults.
- Per-thread or per-turn override.
- Model reroute display.
- Context and token usage.
- Context pressure warning.
- Manual compaction.
- Experimental feature discovery.
- Feature-gated enablement only when supported.

### Skills

Keep skill support lightweight:

- List skills available for the selected project/cwd.
- Show skill name, description, and availability.
- Refresh when `skills/changed` is received.
- Insert a skill mention into the composer.
- Show when a skill is invoked in the timeline.

Skill authoring and filesystem-based skill editing are out of scope.

### Hooks

- List discovered hooks.
- Show hook execution lifecycle and result.
- Show hook failures.
- Do not implement hook editing.

### MCP and apps/connectors

Keep integration support focused on Codex execution, not administration.

Support:

- Show configured MCP servers and current status.
- Show startup/authentication errors.
- Display MCP tool calls and results in the timeline.
- Handle MCP approvals and elicitation.
- Show installed/enabled apps when available.
- Insert an app mention into the composer.
- Display app tool calls and side-effect confirmations.

Optional settings page actions:

- Reload MCP configuration.
- Start an official MCP OAuth flow.
- Enable or disable an already configured integration when the installed protocol explicitly supports it.

Do not build:

- Generic MCP resource browser.
- Generic MCP tool execution console.
- Full MCP configuration editor.
- App marketplace.
- Plugin management platform.

### Account and usage

This is Codex account state, not PWA authentication.

Provide a status page that can:

- Read Codex account mode and plan.
- Display whether Codex requires authentication.
- Display rate limits and usage where available.
- Display account or workspace messages.
- Optionally initiate the official Codex login/device-code flow.
- Optionally log out with confirmation.

Do not store API keys, tokens, device codes, or OAuth credentials in browser storage or logs.

### Notifications and attention management

Provide in-app and browser notifications for:

- Approval required.
- User input required.
- Turn completed.
- Turn failed.
- Turn interrupted unexpectedly.
- App-server unavailable or repeatedly restarting.
- Rate-limit or account issue.

Requirements:

- Clicking a notification opens the relevant thread/request.
- Duplicate events do not create duplicate notifications.
- Per-category notification preferences.
- Quiet mode.
- Badge count for unresolved attention items.
- Foreground resync after mobile browser suspension.

Do not claim reliable background WebSocket operation when iOS has suspended the PWA.

### PWA behavior

- Installable manifest.
- Service worker for static assets.
- Offline application shell.
- Clear unavailable/disconnected state.
- Responsive phone, tablet, and desktop layout.
- Portrait and landscape support.
- iOS safe-area support.
- Dark and light themes.
- Persistent UI preferences.
- Draft composer persistence in IndexedDB.
- Restore last project and thread.
- Automatic reconnect after sleep, app switching, and network changes.
- Full state refresh when replay is unavailable.
- Optional screen wake lock while following an active turn.
- Efficient rendering of long transcripts and command output.

### code-server integration

Provide navigation, not replication.

Support:

- Open project in code-server.
- Open a referenced file in code-server when the event provides a valid path.
- Open a file at a line number when the configured code-server URL format supports it.
- Copy project-relative path.
- Copy command for manual execution in code-server.
- Display a clear “Continue in code-server” action from:
  - Command output.
  - Diff.
  - File-change card.
  - Error card.
  - Review finding.

All paths used for deep links must be validated as belonging to the configured project root.

### Diagnostics

Provide:

- App-server status.
- Codex and protocol version information.
- Capability inspector.
- Redacted app-server stderr.
- Redacted event inspector.
- Export thread transcript as Markdown or JSON.
- Export turn diff as patch.
- Copy diagnostic bundle.
- Optional raw RPC console behind an explicit developer-mode switch.

The raw RPC console must not be part of the normal mobile workflow.

---

## 4.2 Explicitly out of scope

- Application user authentication.
- Multi-tenant isolation.
- Public internet exposure.
- General-purpose terminal emulator.
- PTY management.
- Standalone command execution.
- File browser.
- File content editor.
- File create, rename, move, or delete.
- Repository text search.
- Git client.
- Git status, stage, commit, branch, pull, push, rebase, or conflict resolution.
- Applying or reverting patches directly from the PWA.
- VS Code extension support.
- Language server protocol hosting.
- Graphical debugger.
- Full desktop IDE replacement.
- Generic MCP tool console.
- MCP resource browser.
- Full MCP/app/plugin administration.
- Kubernetes.
- Collaborative editing.
- Reliable push notification delivery while iOS has suspended the PWA.
- Automatic approval of every Codex action.

---

## 5. System architecture

```text
┌──────────────────────────────────────────────┐
│ Phone / Tablet / Desktop                     │
│ Angular PWA                                  │
│                                              │
│ - Projects and threads                       │
│ - Conversation timeline                      │
│ - Plans, diffs, reviews                      │
│ - Approvals and questions                    │
│ - Models and execution settings              │
│ - Notifications and diagnostics              │
│ - Links to code-server                       │
└──────────────────────┬───────────────────────┘
                       │ HTTPS + WSS
                       ▼
┌──────────────────────────────────────────────┐
│ Existing Gateway                             │
│                                              │
│ - TLS termination                            │
│ - Existing network access control            │
│ - Proxy /api and /ws                         │
└──────────────────────┬───────────────────────┘
                       │ loopback/private LAN
                       ▼
┌──────────────────────────────────────────────┐
│ Node.js Backend                              │
│                                              │
│ - Static PWA hosting or API origin            │
│ - Browser WebSocket hub                      │
│ - State/reconnect coordinator                │
│ - JSON-RPC broker                            │
│ - App-server supervisor                      │
│ - Project mapping and deep-link validation   │
│ - Notification coordinator                   │
│ - Diagnostics and redaction                  │
└──────────────────────┬───────────────────────┘
                       │ JSONL over stdio
                       ▼
┌──────────────────────────────────────────────┐
│ codex app-server                             │
│                                              │
│ - Threads and turns                          │
│ - Commands and file changes                  │
│ - Approvals                                  │
│ - Models/config/account                      │
│ - Skills, hooks, MCP, and apps               │
└──────────────────────────────────────────────┘
```

The backend must not expose a filesystem editing API, Git API, or arbitrary command API.

---

## 6. Repository structure

Use a pnpm workspace. Nx is optional and should be avoided unless it clearly improves build and test orchestration.

```text
codex-control-pwa/
├── apps/
│   ├── web/
│   │   ├── src/app/
│   │   │   ├── core/
│   │   │   ├── layout/
│   │   │   ├── dashboard/
│   │   │   ├── projects/
│   │   │   ├── threads/
│   │   │   ├── conversation/
│   │   │   ├── plans/
│   │   │   ├── approvals/
│   │   │   ├── diff/
│   │   │   ├── reviews/
│   │   │   ├── integrations/
│   │   │   ├── settings/
│   │   │   ├── notifications/
│   │   │   └── diagnostics/
│   │   └── public/
│   └── server/
│       └── src/
│           ├── bootstrap/
│           ├── config/
│           ├── http/
│           ├── websocket/
│           ├── codex/
│           │   ├── supervisor/
│           │   ├── transport/
│           │   ├── rpc/
│           │   ├── protocol/
│           │   ├── state/
│           │   └── adapters/
│           ├── projects/
│           ├── deep-links/
│           ├── notifications/
│           ├── observability/
│           └── security-boundary/
├── packages/
│   ├── shared/
│   ├── codex-protocol/
│   │   ├── generated/
│   │   ├── schema/
│   │   └── adapters/
│   ├── ui-model/
│   └── test-fixtures/
├── config/
│   ├── projects.example.yaml
│   └── application.example.yaml
├── scripts/
│   ├── generate-codex-protocol.mjs
│   ├── verify-codex-version.mjs
│   └── smoke-app-server.mjs
├── deploy/
│   ├── systemd/
│   └── gateway/
├── docs/
│   ├── architecture.md
│   ├── protocol.md
│   ├── product-boundaries.md
│   ├── operations.md
│   └── testing.md
└── package.json
```

---

## 7. Backend design

## 7.1 App-server supervisor

Implement a state machine:

```text
STOPPED
  → STARTING
  → INITIALIZING
  → READY
  → DEGRADED
  → RESTARTING
  → FAILED
```

Responsibilities:

- Spawn `codex app-server --stdio`.
- Set cwd and environment explicitly.
- Keep stdout reserved for JSONL protocol.
- Capture stderr separately.
- Parse stdout line by line.
- Recover from a malformed line without corrupting later lines.
- Send `initialize`.
- Wait for the successful response.
- Send `initialized`.
- Mark ready only after the handshake.
- Track PID, start time, restart count, Codex version, and protocol version.
- Terminate gracefully during backend shutdown.
- Force kill after a shutdown timeout.
- Restart after unexpected exit.
- Cap restart frequency to prevent crash loops.
- Notify browsers of lifecycle changes.
- Fail pending RPC calls when the process exits.
- Mark unresolved server requests stale until state is resynchronized.

Do not write arbitrary data to app-server stdin outside the RPC writer.

## 7.2 JSON-RPC broker

Create a broker that supports:

- Monotonic internal request IDs.
- Request timeout.
- Pending request map.
- Successful responses.
- Error responses.
- Notifications.
- Server-initiated requests requiring a client response.
- Cleanup after app-server restart.
- Runtime validation in tests and development.
- Forward-compatible parsing in production.
- Redacted protocol logging.

Never use browser request IDs as Codex request IDs directly.

Maintain:

```text
browser request ID ↔ backend correlation ID ↔ Codex RPC ID
```

## 7.3 Browser WebSocket protocol

Do not expose raw Codex JSON-RPC as the only browser protocol. Wrap messages with backend metadata and stable application message types.

Client request:

```json
{
  "type": "rpc.request",
  "requestId": "uuid",
  "method": "thread/list",
  "params": {}
}
```

Response:

```json
{
  "type": "rpc.response",
  "requestId": "uuid",
  "result": {}
}
```

Error:

```json
{
  "type": "rpc.error",
  "requestId": "uuid",
  "error": {
    "code": "CODEX_RPC_ERROR",
    "message": "...",
    "codex": {}
  }
}
```

Codex event:

```json
{
  "type": "codex.event",
  "sequence": 12345,
  "method": "item/completed",
  "params": {}
}
```

Server request:

```json
{
  "type": "codex.serverRequest",
  "requestKey": "opaque-backend-key",
  "method": "item/commandExecution/requestApproval",
  "params": {},
  "expiresAt": null
}
```

Server request response:

```json
{
  "type": "codex.serverRequestResponse",
  "requestKey": "opaque-backend-key",
  "result": {}
}
```

Additional backend messages:

- `system.snapshot`
- `system.status`
- `system.resyncRequired`
- `project.changed`
- `attention.changed`
- `notification`
- `diagnostic.event`

## 7.4 Event sequencing and reconnect

The backend assigns a monotonically increasing sequence number to browser-visible events.

Maintain:

- Runtime sequence number.
- Recent-event ring buffer.
- Current app-server generation ID.
- Current thread status cache.
- Active turn cache.
- Pending server-request cache.
- Attention-state cache.

Browser hello:

```json
{
  "type": "hello",
  "clientId": "persistent-browser-uuid",
  "lastGenerationId": "optional",
  "lastSequence": 123
}
```

Reconnect behavior:

1. If generation matches and missing events remain in the ring buffer, replay them.
2. Otherwise send `system.resyncRequired`.
3. Send a fresh snapshot containing:
   - Backend and app-server state.
   - Configured projects.
   - Loaded or recently active threads.
   - Active turn statuses.
   - Pending approvals/questions.
   - Attention counters.
   - Account and rate-limit summary.
4. Reload the selected thread using Codex APIs.
5. Reconcile provisional streamed items against authoritative thread data.

Never assume that a mobile browser received all deltas before suspension.

## 7.5 State ownership

Authoritative state:

- Codex owns threads, turns, items, transcripts, commands, file changes, and reviews.
- Backend owns RPC mappings, event replay, app-server lifecycle, project mapping, pending browser responses, and notification coordination.
- Browser IndexedDB owns drafts and presentation preferences.

Do not create a second transcript database.

A small SQLite database is optional only for PWA-specific metadata not supported by Codex, such as:

- Per-project UI defaults.
- Saved prompt templates.
- Notification preferences.
- Optional custom project labels.

Prefer server YAML plus IndexedDB for the first release.

## 7.6 Project configuration

Example:

```yaml
projects:
  - id: quant-trading
    name: Quant Trading System
    root: /workspace/quant-trading-system
    codeServerUrl: https://code.example.com/?folder=/workspace/quant-trading-system
    defaults:
      approvalPolicy: unlessTrusted
      sandbox:
        type: workspaceWrite
        networkAccess: false
      reasoningEffort: medium

  - id: smarthome
    name: Smart Home
    root: /workspace/smarthome
    codeServerUrl: https://code.example.com/?folder=/workspace/smarthome
```

At startup:

- Resolve every root with `realpath`.
- Require each root to exist.
- Reject duplicate project IDs.
- Reject overlapping roots unless explicitly allowed.
- Never accept an arbitrary project root from the browser.
- Validate file paths used in code-server deep links against the project root.
- Do not expose filesystem read/write methods.

## 7.7 Attention coordinator

Maintain normalized attention items:

- Approval required.
- Question/input required.
- Turn failed.
- Turn completed.
- App-server unhealthy.
- Account/rate-limit issue.

Each item must include:

- Stable local ID.
- Category.
- Project/thread/turn references.
- Created time.
- Resolved time.
- Priority.
- Deep link target.
- Notification-delivery state.

Rules:

- Deduplicate replayed events.
- Resolve approval attention when any valid client response succeeds.
- Do not clear failed-turn attention merely because the thread is opened.
- Store only lightweight metadata; do not persist full prompts or code.

## 7.8 code-server deep-link service

Responsibilities:

- Map Codex cwd to a configured project.
- Validate referenced file paths.
- Reject traversal and symlink escape.
- Generate project URL.
- Generate file/line URL only when a configured URL template supports it.
- Fall back to opening the project root when a file-specific URL cannot be generated.

This service does not read or modify file contents.

---

## 8. Frontend information architecture

## 8.1 Mobile navigation

Bottom navigation:

1. **Threads**
2. **Work**
3. **Approvals**
4. **Activity**
5. **More**

Definitions:

- **Threads:** project and thread navigation.
- **Work:** selected thread plan, diff, and reviews.
- **Approvals:** unresolved requests and questions.
- **Activity:** active, completed, failed, and attention-requiring turns.
- **More:** settings, integrations, account, and diagnostics.

Desktop/tablet layout:

- Left project/thread sidebar.
- Center conversation.
- Right contextual panel for plan, diff, review, or approval details.

Do not add terminal, file explorer, or Git navigation.

## 8.2 Dashboard

Show:

- Backend and app-server health.
- Active threads.
- Waiting approvals.
- Waiting questions.
- Recent completed turns.
- Recent failed turns.
- Rate-limit/account warning.
- Quick “new task” action by project.
- “Open code-server” action by project.

Do not show Git dirty state unless Codex itself supplies it as part of an event being displayed.

## 8.3 Project screen

Show:

- Project name.
- Root path.
- Active threads.
- Recent threads.
- Waiting approvals.
- Recent Codex activity.
- Project execution defaults.
- New thread action.
- Open code-server action.

Do not show repository tree, branches, commits, or Git controls.

## 8.4 Thread list

Each row should show:

- Name or prompt preview.
- Project.
- Status.
- Model.
- Updated time.
- Pin state.
- Diff/file-change indicator.
- Approval or question badge.
- Child-agent badge where available.

Interactions:

- Tap opens the thread.
- Long press opens thread actions.
- Swipe may expose pin/archive.
- Delete remains inside a confirmation dialog.

## 8.5 Conversation screen

Header:

- Thread name.
- Project/cwd.
- Runtime status.
- Model and reasoning effort.
- Context/token indicator.
- Current sandbox/approval profile.
- Interrupt button while active.
- Menu:
  - Rename.
  - Goal.
  - Fork.
  - Compact.
  - Pin.
  - Archive.
  - Delete.
  - Open in code-server.

Timeline cards:

- User prompt.
- Agent response.
- Reasoning summary.
- Plan progress.
- Command with live output and exit state.
- File-change summary.
- Diff.
- Tool call.
- Review finding.
- Warning.
- Error.
- Context compaction.
- Unknown item fallback.

Composer:

- Multiline text.
- Send.
- Steer while active.
- Stop.
- Attach image.
- Mention file path.
- Mention skill.
- Mention app.
- Prompt template.
- Model and effort override.
- Sandbox and approval preset.
- Draft persistence.

The composer does not provide shell execution.

## 8.6 Work screen

Tabs:

- **Plan**
- **Diff**
- **Review**

Plan:

- Current plan.
- Step progress.
- Active step.
- Related timeline navigation.

Diff:

- Read-only aggregated diff.
- Per-file navigation.
- Copy patch.
- Open file/project in code-server.

Review:

- Review runs.
- Findings grouped by severity and file.
- Open referenced location in code-server.
- Start supported Codex review modes.

Do not include Files, Git, or Terminal tabs.

## 8.7 Approval center

Global list grouped by thread.

Each card shows:

- Request type.
- Project and thread.
- Exact command or affected files.
- cwd.
- Reason.
- Requested network destination.
- Requested permission roots.
- Diff preview where applicable.
- Received time.
- Resolution state.

Buttons must map exactly to protocol-supported outcomes.

Structured MCP forms and user-input questions must have dedicated renderers. Do not reduce them to generic approve/reject buttons.

## 8.8 Activity screen

Show categorized activity:

- Running.
- Waiting for approval.
- Waiting for input.
- Recently completed.
- Failed.
- Interrupted.
- App-server/system events.

Allow filtering by project and category.

Activity is derived from Codex events; it is not a process manager.

## 8.9 Settings and More

Pages:

- Codex status/version.
- Account and usage.
- Models.
- Project defaults.
- Execution profiles.
- Skills.
- Hooks.
- MCP status.
- Apps.
- Notifications.
- Experimental features.
- Diagnostics.
- PWA preferences.

No file, terminal, or Git settings exist.

---

## 9. UI state model

Use normalized state.

Suggested stores:

```text
connection
appServer
projects
threadIndex
threadDetails
turns
items
itemStreams
plans
diffs
reviews
pendingRequests
attention
models
skills
hooks
mcp
apps
account
notifications
preferences
drafts
```

Rules:

- `item/completed` replaces the provisional item.
- Deltas append only while an item is in progress.
- Replayed events are idempotent.
- Unknown fields are retained when possible.
- Unknown item types use a generic inspector.
- On resync, reload authoritative thread state.
- Do not infer command success because output stopped; wait for final item/turn state.
- Do not infer approval resolution until the backend confirms the response.
- Do not create frontend state for direct file edits, terminal sessions, or Git operations.

---

## 10. Codex protocol mapping

Use an adapter layer. UI components must not scatter raw protocol method names.

All method availability must be detected from generated protocol types/schema and handled as optional.

## 10.1 Core lifecycle

- `initialize`
- `initialized`

## 10.2 Threads

Map supported thread methods, including:

- `thread/start`
- `thread/resume`
- `thread/fork`
- `thread/read`
- `thread/list`
- `thread/turns/list` when supported
- `thread/items/list` when supported
- `thread/loaded/list`
- `thread/name/set`
- `thread/goal/set`
- `thread/goal/get`
- `thread/goal/clear`
- `thread/metadata/update`
- `thread/archive`
- `thread/unarchive`
- `thread/delete`
- `thread/unsubscribe`
- `thread/compact/start`

Do not expose shell-command or background-terminal methods as normal PWA features.

Deprecated methods such as `thread/rollback` may appear only in diagnostics when present.

## 10.3 Turns and reviews

- `turn/start`
- `turn/steer`
- `turn/interrupt`
- `review/start`

Support `thread/inject_items` only as an internal or developer capability. It must not replace normal user messages.

## 10.4 Models and execution modes

- `model/list`
- `modelProvider/capabilities/read`
- `experimentalFeature/list`
- `experimentalFeature/enablement/set`
- `permissionProfile/list`
- `collaborationMode/list`
- `environment/info` when available

## 10.5 Skills, hooks, MCP, and apps

Use only methods needed for monitoring, mentions, authentication status, and Codex-driven interaction:

- `skills/list`
- `hooks/list`
- `mcpServerStatus/list`
- `mcpServer/oauth/login` when needed
- `config/mcpServer/reload` when supported
- `app/installed`
- `app/list`
- `app/read`

Tool calls, approvals, elicitation, and results primarily arrive through thread events and server-initiated requests.

Do not expose generic MCP tool-call or resource-read methods as user-facing features in the initial release.

## 10.6 Account and config

- `account/read`
- `account/rateLimits/read`
- `account/usage/read`
- `account/workspaceMessages/read`
- Optional official login/logout methods.
- `config/read`
- `config/value/write`
- `config/batchWrite`

Config writes must be restricted to a documented allowlist required for:

- Model defaults.
- Reasoning settings.
- Sandbox settings.
- Approval policy.
- Supported integrations.
- Supported experimental flags.

Do not build a generic arbitrary-config editor in the normal UI.

## 10.7 Explicitly hidden protocol capabilities

Even if the installed protocol exposes them, do not surface these as standard features:

- Standalone command execution.
- PTY stdin/write/resize.
- Process spawn/kill.
- Background terminal management.
- Filesystem watch as a workspace explorer.
- Arbitrary file read/write.
- Generic tool execution console.

They may be visible only in the capability inspector or raw RPC developer mode.

---

## 11. Approval safety model

No PWA login does **not** mean Codex approvals should be disabled.

Provide selectable execution presets.

### Safe

- Sandbox: workspace write.
- Network disabled.
- Approval policy: ask when needed.

### Normal

- Sandbox: workspace write.
- Network allowed.
- Approval policy: unless trusted.
- Session approvals available when supported.

### Unrestricted

- Full access or danger mode when supported.
- Approval policy configurable.
- Persistent red warning in the thread header.
- Explicit confirmation when selected unless configured as a project default in server-side YAML.

Rules:

- Never silently upgrade from Safe or Normal to Unrestricted.
- Always display the effective sandbox and approval policy.
- Never silently accept command, file, network, permission, app, or MCP requests.
- “Accept for session” must be visually distinct from one-time acceptance.
- Approval already resolved by another client must become read-only immediately.

---

## 12. Performance requirements

### Large transcripts

- Thread list must not load full turns.
- Paginate thread history.
- Load recent turns first.
- Prefer summarized history when the protocol provides it.
- Load full details on expansion.
- Virtualize the conversation timeline.
- Bound command-output memory and DOM size.
- Render only visible output regions.
- Lazy-load diff and syntax-highlighting modules.

### Streaming

- Batch high-frequency deltas into animation-frame or short-interval updates.
- Avoid application-wide Angular change detection for every output fragment.
- Use signals and OnPush-style boundaries.
- Preserve exact output ordering.
- Flush immediately on item completion.
- Keep the composer responsive during heavy output.

### Bundle

Initial mobile route must not include:

- Code editor.
- Terminal emulator.
- Git library.
- Repository-search library.

Lazy-load:

- Diff renderer.
- Syntax highlighter.
- Diagnostics/event inspector.

Cache static assets through the service worker.

---

## 13. Error handling

User-visible categories:

- Gateway/backend unavailable.
- App-server unavailable.
- App-server restarting.
- Codex not installed.
- Protocol mismatch.
- Codex account not authenticated.
- Usage limit exceeded.
- Context window exceeded.
- Network/API connection failed.
- Sandbox failure.
- Command failed.
- Tool/MCP/app failure.
- Turn failed.
- Request timed out.
- Approval already resolved.
- Unsupported method in the installed Codex version.
- Unknown protocol event.
- Invalid code-server deep-link path.

Every error card should include:

- Human-readable summary.
- Technical-details toggle.
- Correlation ID.
- Retry or resync action when valid.
- Copy diagnostics.
- Open project in code-server where useful.

Do not hide a failed turn behind a generic disconnected state.

---

## 14. Observability

### Logs

Structured JSON logs:

- Timestamp.
- Level.
- Component.
- Correlation ID.
- RPC method.
- Duration.
- Result category.
- App-server generation.
- Thread/turn ID where safe.

Default redaction:

- User prompt content.
- Agent response content.
- Command output.
- File contents and diffs.
- API keys and tokens.
- Authorization URLs and codes.
- Environment variables.

Protocol payload logging is allowed only through an explicit temporary diagnostics setting.

### Health endpoints

- `GET /healthz`: backend process alive.
- `GET /readyz`: backend initialized and app-server ready.
- `GET /api/system/status`: detailed internal status.
- `GET /api/version`: application, Node, Codex, and generated-protocol versions.

### Metrics

Optional Prometheus endpoint:

- Connected browser clients.
- App-server restarts.
- Active threads.
- Pending approvals/questions.
- Turn completions and failures.
- RPC latency, count, and errors.
- WebSocket reconnects.
- Replay versus full-resync counts.
- Protocol parse errors.
- Notification counts.

Do not include prompts, commands, paths, or repository content in metric labels.

---

## 15. Gateway and network deployment

The application has no login, so topology is mandatory:

- Backend listens on `127.0.0.1` or a private interface accessible only by the gateway.
- Never bind the unauthenticated backend directly to a public interface.
- Gateway terminates HTTPS.
- Gateway supports WebSocket upgrade.
- Use a long read timeout for active streams.
- Bound image/request upload size.
- Do not expose raw app-server sockets or ports.
- Restrict browser `Origin` to the configured PWA origin.
- Set CSP and standard security headers.
- Do not place secrets in frontend environment files.

Project root and code-server deep-link validation remain required even though authentication is intentionally absent.

---

## 16. Configuration

Example:

```yaml
server:
  host: 127.0.0.1
  port: 3210
  publicOrigin: https://codex.example.internal
  trustProxy: true

codex:
  executable: /usr/local/bin/codex
  args:
    - app-server
    - --stdio
  cwd: /workspace
  startupTimeoutMs: 20000
  requestTimeoutMs: 60000
  restart:
    enabled: true
    minDelayMs: 1000
    maxDelayMs: 30000
    maxRestartsPerMinute: 5
  experimentalApi: true

events:
  replayBufferSize: 10000

notifications:
  enabled: true
  quietMode: false

logging:
  level: info
  protocolPayloads: false
```

Project roots and code-server URLs remain in a server-side project configuration file.

Do not add configuration sections for terminal, filesystem editing, repository search, or Git controls.

---

## 17. Testing strategy

## 17.1 Unit tests

Backend:

- JSONL framing.
- Partial lines.
- Multiple messages in one chunk.
- Malformed-line recovery.
- RPC request/response matching.
- Timeout and process-exit cleanup.
- Server-request mapping.
- Event sequence/replay.
- Generation mismatch and full resync.
- Attention-item deduplication.
- Approval resolution across clients.
- Project mapping.
- Deep-link path validation.
- Protocol-version warning.
- Redaction.

Frontend:

- Event reducers.
- Delta ordering.
- Item completion reconciliation.
- Replayed-event idempotency.
- Pending-request resolution.
- Reconnect and resync.
- Thread filtering and search.
- Draft persistence.
- Notification deduplication.
- Unknown item/request fallback.
- Long command-output virtualization.
- No terminal/editor/Git route or store exists.

## 17.2 Fake app-server integration tests

Create a deterministic fake JSONL app-server that can simulate:

- Initialize success and failure.
- Streaming agent message.
- Streaming command output.
- File diff updates.
- Plan updates.
- Review findings.
- Approval request and response.
- User-input question.
- MCP form elicitation.
- Turn completion, failure, and interruption.
- App-server crash mid-turn.
- Duplicate events.
- Unknown notification.
- Unknown server request.
- Slow response.
- Malformed output.
- Multiple concurrent threads.
- One approval resolved by another browser client.

Use fixture transcripts in `packages/test-fixtures`.

## 17.3 Real Codex smoke tests

Run only when Codex is installed and authenticated:

- Start app-server.
- Initialize.
- List models.
- List threads.
- Start a test thread in a temporary repository.
- Start a harmless read-only turn.
- Observe a command event.
- Interrupt a turn.
- Read the thread back.
- Verify generated protocol compatibility.

The test repository exists only to give Codex a safe cwd. The PWA does not implement repository operations.

## 17.4 End-to-end tests

Use Playwright.

Required profiles:

- iPhone portrait.
- iPhone landscape.
- Android phone.
- iPad/tablet.
- Desktop Chromium.

Scenarios:

- PWA is installable.
- Start a new thread.
- Stream a response.
- Switch between active threads.
- Approve a command.
- Reject a file change.
- Answer a structured question.
- Suspend/reload and recover.
- Backend restart and resync.
- Long command output.
- Large diff.
- Open project/file in code-server.
- Rename, pin, archive, unarchive, compact, fork, and delete.
- Account/usage error.
- Unsupported method fallback.
- Unknown event fallback.
- Verify no terminal, file editor, repository search, or Git controls are present.

## 17.5 Performance tests

- 10 active threads.
- 5 connected browsers.
- 100,000 command-output lines.
- Multi-megabyte read-only diff.
- Thread with thousands of items.
- Rapid 20–100 deltas per second.
- App-server restart during heavy output.
- Reconnect after replay-buffer expiry.

---

## 18. Implementation phases

Each phase ends with tests, documentation, and a runnable production build. Do not proceed while the current phase has failing tests.

## Phase 0 — Protocol spike

Deliver:

- Monorepo skeleton.
- Protocol generation scripts.
- App-server supervisor.
- Initialize/initialized handshake.
- `model/list`.
- `thread/list`.
- `thread/start`.
- `turn/start`.
- Raw redacted event logger.
- Fake app-server harness.
- Version compatibility check.

Acceptance:

- A Node script starts app-server, creates a thread, runs one turn, and streams events.
- Restarting app-server does not crash the backend.
- Generated types compile.
- Unknown notifications are retained and logged safely.

## Phase 1 — Core PWA and thread control

Deliver:

- Angular PWA shell.
- Gateway-ready HTTP/WSS backend.
- Browser WebSocket protocol.
- Project configuration.
- App-server status.
- Thread list and filtering.
- New and resumed threads.
- Basic conversation timeline.
- Composer.
- Turn steer and interrupt.
- Reconnect snapshot.
- code-server project links.

Acceptance:

- A phone can start and follow at least two Codex threads.
- Reload restores the selected project/thread and draft.
- No application login exists.
- No terminal, editor, file manager, repository search, or Git UI exists.

## Phase 2 — Complete timeline and attention handling

Deliver:

- All known item renderers.
- Delta handling.
- Plan rendering.
- Command/test output streaming.
- File-change summaries.
- Pending approval/question center.
- Command, file, network, permission, user-input, MCP, and app request handlers.
- Attention state.
- Browser notifications where available.

Acceptance:

- Every server request has a specific renderer or a generic safe fallback.
- First valid response resolves the request across connected clients.
- Reconnect restores unresolved requests.
- Heavy command output remains responsive.

## Phase 3 — Diff, review, and full thread management

Deliver:

- Aggregated read-only diff.
- Per-file diff.
- Review workflows.
- Rename, goal, pin, fork, archive, unarchive, compact, and delete.
- Paginated thread/turn history.
- Export transcript and patch.
- File/project deep links to code-server.

Acceptance:

- Large history and diff remain usable on a phone.
- Completed items replace provisional streamed state.
- Delete requires confirmation.
- No direct patch apply, revert, Git action, or file editing exists.

## Phase 4 — Models, execution settings, and integrations

Deliver:

- Model, effort, personality, and collaboration controls where supported.
- Sandbox and approval presets.
- Account and usage status.
- Context pressure and rate-limit displays.
- Skills list and mentions.
- Hook status.
- MCP status, OAuth flow, approvals, and elicitation.
- App list, mentions, calls, and side-effect confirmations.
- Allowlisted config writes.
- Experimental feature page.
- Developer-only capability inspector and raw RPC console.

Acceptance:

- Unsupported methods do not break the application.
- Config changes show before/after values and require confirmation.
- Credentials never enter logs or IndexedDB.
- Generic MCP tool execution and resource browsing are not present.

## Phase 5 — Hardening and operations

Deliver:

- Structured logging and redaction.
- Health and readiness.
- Metrics.
- systemd service.
- Gateway sample config.
- Backup/restore notes for app configuration.
- Full Playwright suite.
- Load tests.
- Diagnostic bundle.
- Operations documentation.
- Product-boundary regression tests.

Acceptance:

- Backend recovers automatically from app-server crash.
- Browser recovers after mobile suspension.
- Project/deep-link boundaries are tested.
- Application starts after reboot.
- Automated tests fail if terminal, editor, filesystem-management, repository-search, or Git-control modules are introduced without an explicit scope revision.

---

## 19. Systemd deployment

The backend service should:

- Run as the same non-root development user as Codex/code-server.
- Start after network availability.
- Set the working directory explicitly.
- Load an environment file.
- Restart on failure.
- Use a reasonable restart delay.
- Preserve access to the user's home, Codex config, project roots, Git config, SSH configuration, and local tools needed by Codex itself.
- Avoid hardening directives that break Codex sandbox behavior until tested.

The backend spawns app-server. Do not create a second independently managed app-server service in the first release.

The service does not need PTY, terminal multiplexing, or Git API support for the PWA.

---

## 20. Acceptance checklist

The project is complete only when all required statements are true.

### Access and deployment

- [ ] No login page or application-auth code exists.
- [ ] Backend is not publicly bound.
- [ ] Gateway proxies HTTPS and WSS.
- [ ] Raw app-server transport is not exposed.
- [ ] Service starts after reboot.

### Codex core

- [ ] App-server handshake works.
- [ ] Installed Codex/protocol mismatch is visible.
- [ ] Threads can start, resume, fork, rename, pin, archive, compact, and delete.
- [ ] Multiple turns can stream concurrently.
- [ ] Active turns can be steered and interrupted.
- [ ] App-server restart is recoverable.

### Mobile control UI

- [ ] Timeline renders all known coding-related items.
- [ ] Unknown items do not crash the UI.
- [ ] Plans, reasoning summaries, command output, file changes, reviews, warnings, and errors are readable on a phone.
- [ ] Diff is usable in portrait mode.
- [ ] Activity and attention states are clear.
- [ ] Project/file deep links open code-server where supported.
- [ ] No terminal emulator exists.
- [ ] No file browser or code editor exists.
- [ ] No repository search exists.
- [ ] No Git controls exist.

### Approvals and questions

- [ ] Command approval works.
- [ ] File-change approval works.
- [ ] Network approval is rendered specifically.
- [ ] Permission request works.
- [ ] User-input question works.
- [ ] MCP form and URL elicitation work.
- [ ] Resolved requests update across connected clients.
- [ ] No approval is silently accepted.

### Models and integrations

- [ ] Model and reasoning settings work when supported.
- [ ] Effective sandbox and approval policy are visible.
- [ ] Skills can be mentioned.
- [ ] MCP status and Codex-driven interaction are visible.
- [ ] App mentions and tool-call rendering work when supported.
- [ ] Unsupported capabilities degrade gracefully.

### Mobile reliability

- [ ] Draft survives reload.
- [ ] Foreground resync occurs after suspension.
- [ ] Missed events replay or trigger full resync.
- [ ] Large output does not freeze the browser.
- [ ] Portrait, landscape, and safe areas work.
- [ ] PWA is installable.
- [ ] Notification clicks navigate to the correct item.

### Boundaries

- [ ] Arbitrary project roots cannot be supplied by the browser.
- [ ] File paths used in deep links cannot escape configured roots.
- [ ] PWA has no filesystem-write API.
- [ ] PWA has no arbitrary-command API.
- [ ] PWA has no Git API.
- [ ] Source content and secrets are redacted from default logs.
- [ ] Product-boundary tests prevent accidental IDE scope creep.

---

## 21. Instructions to the coding agent

1. Implement phases in order.
2. Inspect the installed Codex version before implementing protocol behavior.
3. Generate protocol types and schemas from the installed binary.
4. Treat generated schema and verified runtime behavior as the source of truth.
5. Do not guess protocol payloads.
6. Preserve unknown fields and provide generic fallbacks.
7. Keep Codex integration behind adapters.
8. Add tests with each protocol and state feature.
9. Test fake app-server behavior before real app-server behavior.
10. Do not add application authentication.
11. Do not expose the backend or app-server publicly.
12. Do not globally disable Codex sandbox or approval controls.
13. Do not implement terminal, editor, file-management, repository-search, or Git-control features.
14. Use code-server deep links whenever the user must continue with direct coding work.
15. Keep integrations focused on Codex status, mentions, approvals, and event display.
16. Make small commits per completed capability.
17. After every phase, run:
    - Type checking.
    - Unit tests.
    - Integration tests.
    - Production build.
    - Relevant Playwright tests.
18. Document any installed Codex behavior that differs from this plan.
19. When protocol behavior conflicts with this document, follow generated schema and verified runtime behavior, then update the protocol documentation without expanding product scope.
20. Reject scope-creep proposals unless they directly improve monitoring, directing, approving, or understanding Codex.

---

## 22. First implementation task

The first task for Codex should be:

> Create the pnpm monorepo, generate protocol types from the installed Codex binary, and implement a tested JSONL app-server supervisor plus JSON-RPC broker. Complete the initialize/initialized handshake, expose system status, and prove `model/list`, `thread/list`, `thread/start`, and `turn/start` against both a deterministic fake app-server and a real temporary project. Do not build editor, terminal, filesystem, search, or Git modules. Do not begin the complete UI until the protocol spike passes.

This sequence removes the highest-risk protocol uncertainty while preserving the lightweight product boundary.
