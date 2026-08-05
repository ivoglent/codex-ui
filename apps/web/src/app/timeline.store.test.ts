import { describe, expect, it } from "vitest";
import { TimelineStore } from "./timeline.store";
describe("TimelineStore", () => {
  it("is idempotent and replaces provisional items with completion", () => { const store = new TimelineStore(); const started: any = { type: "codex.event", generationId: "g", sequence: 1, method: "item/started", params: { item: { id: "i" } } }; store.accept(started); store.accept(started); store.accept({ type: "codex.event", generationId: "g", sequence: 2, method: "item/completed", params: { item: { id: "i", text: "done" } } }); expect(store.events()).toHaveLength(1); expect(store.events()[0].method).toBe("item/completed"); });
  it("tracks plan and diff state", () => { const store = new TimelineStore(); store.accept({ type: "codex.event", generationId: "g", sequence: 1, method: "turn/plan/updated", params: { turnId: "t", plan: [] } }); store.accept({ type: "codex.event", generationId: "g", sequence: 2, method: "turn/diff/updated", params: { turnId: "t", diff: "patch" } }); expect(store.plans().t).toBeTruthy(); expect(store.diffs().t).toBe("patch"); });
});
