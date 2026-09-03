# Draft Plan — Project Creation and Mobile Chat Reliability

**Status:** Implemented; PR validation in progress  
**Target branch:** New feature branch from current `origin/develop`  
**Delivery:** One focused pull request into `develop`, opened only after the full test pipeline passes

## 1. Goal

Add a mobile-first flow that creates a project under the configured projects root, registers it persistently, starts a default Codex session, and asks Codex to initialize a README. At the same time, make chat composition reliable on mobile by preserving multiline input, keeping a bottom-following conversation stable during streaming, and preventing sends while the backend is disconnected.

## 2. Confirmed behavior

- Reuse the existing `+` action. It opens a compact menu with:
  - **New session**
  - **New project**
- New Project asks only for a display name.
- Convert the name into a safe lowercase directory slug, for example `Trading Worker` becomes `trading-worker`.
- Create the directory directly under the configured projects root.
- Do not initialize Git.
- Reject an existing directory, project id, or registered root with a clear error. Do not reuse it.
- Persist UI-created projects in `${CODEX_HOME}/codex-ui/projects.json`.
- Persist only identity/root metadata; derive the current discovery defaults and code-server base URL when loading so future default changes are inherited.
- No rename or delete support in this change.
- After project creation:
  1. Select the new project.
  2. Start a Codex thread using its root as `cwd` and its inherited defaults.
  3. Name the thread `Project setup`.
  4. Start this task:

     > Initialize this project by creating a README.md that explains the project purpose, initial structure, and getting-started instructions. Do not create unrelated files.

- If thread naming or README initialization fails, keep the project and thread, show the exact failure, and allow the user to retry through normal chat controls.
- Enter/Return always inserts a newline in the composer. Sending is only through the Send button.
- While streaming, keep following the bottom if the user was already at the bottom, including while the user types and the composer changes height. Never force the user back down after an intentional upward scroll.
- When disconnected, keep the draft editable, show an offline notice, and disable all chat-send actions until connected.

## 3. Architecture and contracts

### 3.1 Server-owned project creation

Add a server service and a narrow HTTP endpoint rather than representing filesystem creation as a Codex RPC.

`POST /api/projects`

Request:

```json
{ "name": "Trading Worker" }
```

Success (`201`):

```json
{
  "project": {
    "id": "trading-worker",
    "name": "Trading Worker",
    "root": "/configured/projects/root/trading-worker",
    "codeServerUrl": "https://code.example/?folder=%2Fconfigured%2Fprojects%2Froot%2Ftrading-worker",
    "defaults": {}
  }
}
```

Expected failures:

- `400`: missing, empty, oversized, or unusable name.
- `409`: slug, directory, id, or root already exists.
- `503`: projects root or persistence store is unavailable/unwritable.
- `500`: unexpected filesystem/persistence error, returned without leaking sensitive paths beyond the configured project target needed for diagnosis.

The endpoint accepts no caller-provided path, defaults, URL, Git option, or initialization prompt.

### 3.2 Persistence and runtime registry

Refactor `ProjectRegistry` so it retains:

- Static YAML projects.
- Discovered projects.
- UI-created project records loaded from the JSON store.
- The resolved writable projects root, discovery defaults, and code-server base URL needed for new records.

Creation is serialized within the server process. The operation:

1. Validate and slugify the display name.
2. Resolve the configured projects root and verify the target remains its direct child.
3. Check registry id/root collisions and target existence.
4. Create the target directory exclusively.
5. Write a schema-versioned JSON document atomically using a sibling temporary file and rename.
6. Publish the new immutable project snapshot only after persistence succeeds.
7. If persistence fails, remove only the directory created by this request when it is still empty; never remove a pre-existing target.

On startup, validate persisted records with the same id/root/overlap rules as configured projects. A malformed persistence file must fail visibly rather than silently losing registrations.

### 3.3 Multi-client synchronization

After a successful registry mutation, the server broadcasts a fresh `system.snapshot` (or a focused project-change event that the connection service merges into its snapshot) to every connected browser. The creating client also receives the project in the HTTP response so it can continue without waiting for WebSocket delivery. Repeated delivery must not duplicate the project in client state.

### 3.4 Client initialization sequence

The UI performs filesystem creation only through `POST /api/projects`. After `201` it uses existing Codex methods in order:

1. `thread/start` with the returned project root and defaults.
2. `thread/name/set` with `Project setup`.
3. `turn/start` with the README prompt.

Project creation is complete once the server returns `201`; later Codex failures do not roll it back. The UI selects the created project/thread as soon as each exists, shows progress, prevents duplicate taps, and reports which initialization stage failed.

## 4. Implementation steps

### Step 1 — Extend the project registry

Files:

- `apps/server/src/config/projects.ts`
- A new focused persistence/service module under `apps/server/src/config/` if keeping filesystem mutation separate improves testability
- Shared project types only if a persisted-record or response type is used across packages

Changes:

- Add deterministic display-name validation and lowercase slug generation.
- Resolve one creation root from the configured discovery roots. Startup fails with a clear configuration error if project creation is enabled but there is not exactly one usable root.
- Load `${CODEX_HOME}/codex-ui/projects.json`, with an environment override for deterministic tests and deployments if needed.
- Merge persisted records through the existing duplicate and overlapping-root validation.
- Make registry snapshots replaceable internally while exposing readonly project data.
- Add serialized `create(name)` behavior with exclusive directory creation, atomic persistence, and narrowly scoped cleanup on failure.
- Derive defaults and code-server URLs from the current discovery configuration rather than persisting copies.

### Step 2 — Add and secure the HTTP API

Files:

- `apps/server/src/main.ts`
- A small HTTP request/body helper if necessary
- `apps/server/src/websocket/hub.ts`

Changes:

- Route `GET /api/projects` explicitly by method.
- Add `POST /api/projects` with JSON-only input, a small body-size limit, predictable errors, and the configured public-origin check when an `Origin` header is present.
- Return `201` and the fully resolved project.
- Notify connected clients after successful mutation.
- Preserve the existing gateway-as-auth-boundary model; add no login or arbitrary filesystem API.

### Step 3 — Add the `+` action menu and project dialog

Files:

- `apps/web/src/app/app.component.ts`
- `apps/web/src/app/app.component.html`
- `apps/web/src/styles.css`

Changes:

- Replace the direct `+` handler with an accessible menu patterned after the composer options menu.
- Keep New Session behavior unchanged.
- Add a mobile-sized New Project dialog containing only the name field, Cancel, and Create.
- Disable submission while disconnected or while creation is in progress.
- Call the server endpoint, select the returned project, then execute the initialization sequence.
- Keep the created project/session selected if naming or README initialization fails and show a clear stage-specific notification.
- Close menus/dialogs on Escape, preserve focus behavior, and avoid viewport overflow on a 390x844 mobile screen.

### Step 4 — Make connection state explicit at send boundaries

Files:

- `apps/web/src/app/connection.service.ts`
- `apps/web/src/app/app.component.ts`
- `apps/web/src/app/app.component.html`
- `apps/web/src/styles.css`

Changes:

- Expose a clear `canSend`/connected condition to the component.
- Make user-initiated send and steer fail immediately with `Backend is disconnected` instead of waiting ten seconds for an implicit reconnect.
- Disable the Send button while connecting/disconnected, but leave the textarea and saved draft enabled.
- Show an inline, screen-reader-announced offline message near the composer.
- Re-enable Send automatically after the WebSocket is open.
- Do not append an optimistic user message or clear the draft unless a send attempt can actually start.
- Apply the same connection guard to New Session and New Project operations that require the backend.

### Step 5 — Make composer input mobile-first

Files:

- `apps/web/src/app/app.component.ts`
- `apps/web/src/app/app.component.html`

Changes:

- Remove Enter-to-send behavior, including Shift/Ctrl/Meta variants.
- Allow the browser and IME to insert newlines normally.
- Keep button-only submission for both new turns and steering.
- Preserve textarea auto-growth and draft persistence.

### Step 6 — Preserve sticky-bottom during streaming and typing

Files:

- `apps/web/src/app/chat-scroll.ts`
- `apps/web/src/app/app.component.ts`
- Potentially `apps/web/src/app/app.component.html` for an explicit bottom sentinel/state hook

Changes:

- Separate user intent (`following latest`) from a post-layout distance calculation.
- Capture bottom-following state before timeline or composer resize mutations.
- If following latest, schedule an `auto` scroll after streaming content or composer height changes settle.
- If the user scrolls upward beyond the threshold, stop following and accumulate unseen updates.
- Resume following only when the user returns near the bottom or taps Scroll to latest.
- Avoid restoring a stale saved `scrollTop` during live updates or initial/reloaded-session bottom positioning.
- Coalesce observers through animation frames to avoid scroll/resize feedback loops.

## 5. Tests and validation

### Server tests

Extend `apps/server/test/project-registry.test.ts` and add focused API tests as appropriate:

- Safe slug generation, Unicode/whitespace handling, empty-result rejection, and length limits.
- Project is created only as a direct child of a temporary projects root.
- Existing id/directory/root returns a stable collision error.
- Concurrent same-name creation yields one success and one conflict.
- Persisted project survives registry reload and inherits current defaults.
- Atomic-write failure does not expose a project and removes only the request-created empty directory.
- Malformed persistence and unwritable roots fail clearly.
- `POST /api/projects` validates method, content type, body size, JSON shape, and origin.
- Successful creation updates connected-client project state.

All tests use temporary directories and an overridden persistence path; they never touch the developer's real project root or Codex home.

### Web unit tests

- `+` menu exposes both actions and retains existing New Session behavior.
- New Project validates the name, prevents duplicate submission, and follows create/start/name/turn order.
- Project remains selected when the README turn fails.
- Enter and modifier+Enter insert newlines and never invoke send.
- Disconnected state leaves drafts editable, disables Send, shows the offline notice, and prevents optimistic messages.
- Reconnection re-enables Send without losing the draft.
- Sticky-bottom remains active across timeline growth and composer resize.
- Intentional upward scroll stops auto-follow and preserves unseen-update behavior.

### Browser tests

Extend `apps/web/e2e/app.spec.ts` with mobile viewport coverage:

- Create a project through the `+` menu and verify the selected `Project setup` session receives the README task.
- Verify a collision error is clear and no duplicate project appears.
- Type a multiline mobile prompt and submit only with the Send button.
- Disconnect the WebSocket, verify offline notification/send disablement and draft retention, then reconnect and send.
- Stream expanding chat content while typing; assert the viewport stays at the bottom.
- Scroll upward during streaming; assert it does not snap back until Scroll to latest is used.

### Required clean pipeline before PR

Run the repository's complete CI-equivalent sequence from a clean branch, including:

- Web unit tests.
- Server unit/integration tests.
- Type checking/lint checks.
- Production build and CSP validation.
- Full Playwright browser suite at the CI viewport set.
- `git diff --check` and final worktree review.

Fix failures before pushing. Then commit, push, open a new PR into `develop`, and confirm the remote CI run is green.

## 6. Operational notes

- Ensure `${CODEX_HOME}/codex-ui` and the chosen projects root are writable by the service user/container UID.
- The existing `${HOST_HOME}/.codex` and `${PROJECTS_ROOT}` read/write mounts support the planned storage locations; document any new environment override in the example configuration.
- Log project-creation stage and slug, but do not log request headers, credentials, arbitrary request bodies, or Codex prompt content.
- No migration of YAML-discovered projects is required. The JSON file is additive and may initially be absent.

## 7. Out of scope

- Project rename or deletion.
- Choosing an arbitrary parent directory.
- Git initialization or repository operations.
- A general file browser or project editor.
- Custom initialization prompts/templates.
- Rolling back a successfully registered project because Codex session or README initialization failed.
- Queuing chat sends while offline.

## 8. Acceptance criteria

- A user can create a uniquely named project from the mobile `+` menu using only a display name.
- The server creates exactly one safe directory under the configured root and the project survives restart.
- The new project inherits current defaults, is visible to connected clients, and opens with a selected `Project setup` session.
- Codex receives the agreed README initialization task automatically.
- Clear errors preserve consistent state at every failure boundary.
- Enter creates newlines; only the Send button submits.
- Offline users retain drafts, see a clear notice, and cannot send.
- Streaming content and composer resizing do not move a bottom-following user to the top, while intentional upward scrolling remains respected.
- The full local and remote CI pipelines pass before the PR is handed off.
