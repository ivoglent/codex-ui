import { Injectable } from "@angular/core";

export interface CachedThreadItem {
  /** App-server item ID: the cross-device deduplication key. */
  id: string;
  /** Stable local presentation order; it makes a cache deterministic. */
  index: number;
  turnId: string;
  item: any;
}

// Increment this whenever the representation or completeness guarantees of an
// item change. A stale cache is safely rebuilt from the authoritative thread
// endpoints instead of being mistaken for a complete local history.
export const THREAD_HISTORY_FORMAT = 2;

export interface ThreadHistory { format: number; threadId: string; nextIndex: number; items: CachedThreadItem[]; }

export function isCurrentThreadHistory(history: unknown): history is ThreadHistory {
  return Boolean(history && typeof history === "object" && (history as ThreadHistory).format === THREAD_HISTORY_FORMAT && Array.isArray((history as ThreadHistory).items));
}

/** Only a completed event is safe to retain as durable message history. */
export function completedThreadItem(event: any): event is { method: "item/completed"; params: { threadId: string; turnId: string; item: { id: string } } } {
  return event?.method === "item/completed" && typeof event.params?.threadId === "string" && typeof event.params?.turnId === "string" && typeof event.params?.item?.id === "string";
}

export function mergeThreadItems(current: ThreadHistory | undefined, threadId: string, entries: Array<{ turnId: string; item: any }>): ThreadHistory {
  const existing = current?.items ?? [];
  const byId = new Map(existing.map((entry) => [entry.id, entry]));
  let nextIndex = current?.nextIndex ?? existing.reduce((max, entry) => Math.max(max, entry.index + 1), 0);
  for (const entry of entries) {
    const id = typeof entry.item?.id === "string" ? entry.item.id : "";
    if (!id) continue;
    const previous = byId.get(id);
    byId.set(id, previous ? { ...previous, turnId: entry.turnId, item: entry.item } : { id, index: nextIndex++, turnId: entry.turnId, item: entry.item });
  }
  return { format: THREAD_HISTORY_FORMAT, threadId, nextIndex, items: [...byId.values()].sort((left, right) => left.index - right.index) };
}

export function cachedThread(thread: any, history: ThreadHistory | undefined): any {
  if (!history?.items.length) return { ...thread, turns: [] };
  const turns = new Map<string, any>();
  for (const entry of history.items) {
    const turn = turns.get(entry.turnId) ?? { id: entry.turnId, items: [] };
    turn.items.push(entry.item);
    turns.set(entry.turnId, turn);
  }
  return { ...thread, turns: [...turns.values()] };
}

@Injectable({ providedIn: "root" })
export class ThreadHistoryStore {
  // Live item notifications can arrive in the same microtask. Serialize writes
  // so two read-modify-write merges never overwrite one another.
  private writes: Promise<void> = Promise.resolve();
  private readonly db = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("codex-control", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("drafts")) request.result.createObjectStore("drafts");
      if (!request.result.objectStoreNames.contains("thread-history")) request.result.createObjectStore("thread-history");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  async get(threadId: string): Promise<ThreadHistory | undefined> {
    const db = await this.db;
    return new Promise((resolve, reject) => { const request = db.transaction("thread-history").objectStore("thread-history").get(threadId); request.onsuccess = () => resolve(isCurrentThreadHistory(request.result) ? request.result : undefined); request.onerror = () => reject(request.error); });
  }
  async merge(threadId: string, entries: Array<{ turnId: string; item: any }>): Promise<ThreadHistory> {
    const result = this.writes.then(() => this.mergeNow(threadId, entries));
    this.writes = result.then(() => undefined, () => undefined);
    return result;
  }
  private async mergeNow(threadId: string, entries: Array<{ turnId: string; item: any }>): Promise<ThreadHistory> {
    const next = mergeThreadItems(await this.get(threadId), threadId, entries);
    const db = await this.db;
    await new Promise<void>((resolve, reject) => { const request = db.transaction("thread-history", "readwrite").objectStore("thread-history").put(next, threadId); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
    return next;
  }
}
