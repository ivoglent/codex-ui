import type { UiEvent } from "./connection.service";

/**
 * App-server notifications carry their owner explicitly. Never infer ownership
 * from arbitrary payload text: users can legitimately paste another thread ID.
 */
export function belongsToThread(event: UiEvent, threadId: string, knownTurnIds: ReadonlySet<string> = new Set()): boolean {
  if (event.params?.threadId !== undefined) return event.params.threadId === threadId;
  const turnId = event.params?.turnId ?? event.params?.turn?.id;
  return typeof turnId === "string" && knownTurnIds.has(turnId);
}

export function mergeResumedThread(current: any, resumed: any): any {
  if (!resumed || current?.id !== resumed.id) return resumed;
  const resumedTurnIds = new Set((resumed.turns ?? []).map((turn: any) => turn.id));
  const signature = (turn: any) => JSON.stringify((turn.items ?? []).filter((item: any) => item.type === "userMessage").flatMap((item: any) => item.content ?? []));
  const persistedCounts = new Map<string, number>();
  for (const turn of current.turns ?? []) if (!String(turn.id).startsWith("local-turn-")) persistedCounts.set(signature(turn), (persistedCounts.get(signature(turn)) ?? 0) + 1);
  const resumedCounts = new Map<string, number>();
  for (const turn of resumed.turns ?? []) resumedCounts.set(signature(turn), (resumedCounts.get(signature(turn)) ?? 0) + 1);
  const acknowledgements = new Map([...resumedCounts].map(([key, count]) => [key, Math.max(0, count - (persistedCounts.get(key) ?? 0))]));
  const optimisticTurns = (current.turns ?? []).filter((turn: any) => {
    if (!String(turn.id).startsWith("local-turn-") || resumedTurnIds.has(turn.id)) return false;
    const key = signature(turn), acknowledged = acknowledgements.get(key) ?? 0;
    if (!acknowledged) return true;
    acknowledgements.set(key, acknowledged - 1);
    return false;
  });
  return optimisticTurns.length ? { ...resumed, turns: [...(resumed.turns ?? []), ...optimisticTurns] } : resumed;
}
