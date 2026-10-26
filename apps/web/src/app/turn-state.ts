import type { UiEvent } from "./connection.service";

function turnId(event: UiEvent): string | undefined {
  const id = event.params?.turnId ?? event.params?.turn?.id;
  return typeof id === "string" ? id : undefined;
}

/**
 * Return the running turn that the app-server needs for `turn/interrupt`.
 * Lifecycle events are authoritative for turns started by this browser; after
 * a refresh, fall back to the resumed thread's in-progress turn.
 */
export function activeTurnId(events: readonly UiEvent[], localTurnIds: ReadonlySet<string>, turns: readonly any[] = []): string | undefined {
  const lifecycle = events
    .filter((event) => (event.method === "turn/started" || event.method === "turn/completed") && localTurnIds.has(turnId(event) ?? ""));
  if (lifecycle.length) {
    const latest = lifecycle.at(-1);
    return latest?.method === "turn/started" ? turnId(latest) : undefined;
  }
  return [...turns].reverse().find((turn) => turn?.status === "inProgress")?.id;
}

/** Return the newest lifecycle event for the selected thread. */
export function latestTurnLifecycle(events: readonly UiEvent[]): "turn/started" | "turn/completed" | undefined {
  return [...events].reverse().find((event) => event.method === "turn/started" || event.method === "turn/completed")?.method as "turn/started" | "turn/completed" | undefined;
}
