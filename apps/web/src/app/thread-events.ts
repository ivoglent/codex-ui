import type { UiEvent } from "./connection.service";

/**
 * App-server notifications carry their owner explicitly. Never infer ownership
 * from arbitrary payload text: users can legitimately paste another thread ID.
 */
export function belongsToThread(event: UiEvent, threadId: string): boolean {
  return event.params?.threadId === threadId;
}
