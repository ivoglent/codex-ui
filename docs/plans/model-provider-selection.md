# Plan: Session Model and Provider Selection

## 1. Objective

Allow users to choose an atomic model/provider pair when starting a session and switch that pair for subsequent messages from the composer three-dot menu. Keep ChatGPT as the default and use Codex's mounted configuration as the source of custom pairs.

## 2. Scope

- **In scope:** Read top-level `${CODEX_HOME}/*.config.toml` presets, combine them with app-server `model/list`, add a new-session picker, add an in-chat switcher, synchronize from app-server responses, preserve the previous pair on failure, and cover desktop/mobile behavior with automated tests.
- **Out of scope:** Editing Codex configuration, independently combining arbitrary models and providers, changing provider credentials, automatic provider fallback, or changing historical messages.

## 3. Approach

1. Add a read-only server component and HTTP endpoint that discovers regular top-level `*.config.toml` files and returns only validated `model` and `model_provider` pairs.
2. Build one client catalog from ChatGPT models returned by `model/list` and custom pairs returned by the endpoint. Represent each choice as one indivisible pair.
3. Add an accessible new-session dialog. Its initial choice is `ChatGPT (default)`, which omits overrides and lets Codex select its configured default.
4. Capture authoritative `model` and `modelProvider` values from `thread/start` and `thread/resume` responses.
5. Add the current pair and pair selector to the composer menu. Continue idle sessions with `thread/fork` overrides so both model and provider change while preserving history; keep the source session available.
6. Disable switching during an active turn. Update visible state only after a successful response and retain the previous state on error.
7. Extend the fake app-server and automated tests for discovery, creation, switching, failure behavior, refresh/reconnect state, and the 390x844 mobile layout.

## 4. Risk Assessment

| # | Risk | Category | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| 1 | `config/read` omits separate preset files | Technical | High | High | Discover mounted top-level `*.config.toml` files through a narrow read-only endpoint |
| 2 | Invalid model/provider combinations | Technical | Medium | High | Expose only atomic pairs from trusted sources |
| 3 | Model changes without its provider | Technical | High | High | Use provider-aware `thread/fork`; loaded-thread `thread/resume` ignores runtime overrides and `thread/settings/update` has no provider field |
| 4 | Optimistic UI diverges from Codex | Technical | Medium | High | Accept the response pair as authoritative and update only on success |
| 5 | Switching races with an active turn | Operational | Medium | Medium | Disable the selector while active or while a switch is pending |
| 6 | Refresh loses the selected pair | Technical | Medium | Medium | Restore it from every resume response |
| 7 | Presets expose unrelated configuration | Security | Medium | Medium | Return only two validated string fields; exclude URLs, environment keys, and file contents |
| 8 | Picker overflows on mobile | UI | Medium | Medium | Reuse bounded dialogs/menus and test at 390x844 |
| 9 | Provider credentials are unavailable | Operational | Medium | Medium | Show the app-server error, retain the old pair, and never fall back silently |

## 5. Dependencies & Constraints

- Codex app-server remains the authority for native ChatGPT models and session runtime state.
- `${CODEX_HOME}` is already mounted into the server container.
- Custom presets use a top-level `*.config.toml` file containing string `model` and `model_provider` fields.
- The existing app-server integration and protocol version must support provider-aware `thread/resume` overrides.

## 6. Milestones & Timeline

1. Preset discovery and endpoint with unit coverage.
2. Shared model catalog and new-session selection.
3. In-chat switching and response-driven synchronization.
4. Desktop/mobile tests and full repository validation.

## 7. Open Items

None. The user approved the convention and risk assessment on 2026-08-07.
