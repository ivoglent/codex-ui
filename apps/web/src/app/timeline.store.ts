import { Injectable, signal } from "@angular/core";
import type { UiEvent } from "./connection.service";

@Injectable({ providedIn: "root" })
export class TimelineStore {
  readonly events = signal<UiEvent[]>([]); readonly plans = signal<Record<string, unknown>>({}); readonly diffs = signal<Record<string, string>>({});
  private readonly seen = new Set<string>(); private readonly completedItems = new Map<string, UiEvent>();
  accept(event: UiEvent): void {
    const key = `${event.generationId}:${event.sequence}`; if (this.seen.has(key)) return; this.seen.add(key);
    const itemId = event.params?.item?.id ?? event.params?.itemId;
    if (event.method === "item/completed" && itemId) this.completedItems.set(itemId, event);
    if (event.method === "turn/plan/updated") this.plans.update((plans) => ({ ...plans, [event.params?.turnId ?? "unknown"]: event.params }));
    if (event.method === "turn/diff/updated") this.diffs.update((diffs) => ({ ...diffs, [event.params?.turnId ?? "unknown"]: event.params?.diff ?? "" }));
    this.events.update((events) => {
      let next = events;
      if (event.method === "item/completed" && itemId) next = events.filter((existing) => (existing.params?.item?.id ?? existing.params?.itemId) !== itemId);
      const bounded = [...next, event]; return bounded.length > 4_000 ? bounded.slice(-4_000) : bounded;
    });
  }
  reset(events: UiEvent[] = []): void { this.seen.clear(); this.completedItems.clear(); this.events.set([]); events.forEach((event) => this.accept(event)); }
}
