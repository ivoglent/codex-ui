import { describe, expect, it } from "vitest";
import { belongsToThread, mergeResumedThread } from "./thread-events";

describe("belongsToThread", () => {
  it("uses the structured event owner instead of session IDs in message text", () => {
    const selectedThreadId = "019fe9bc-f3b6-7712-bdbc-b179c9ce4dec";
    const event: any = {
      type: "codex.event",
      method: "item/completed",
      params: {
        threadId: "019fe9be-6cbe-7ea2-b776-b1d8c08105f4",
        item: { type: "userMessage", content: [{ type: "text", text: `Check session: ${selectedThreadId}` }] }
      }
    };

    expect(belongsToThread(event, selectedThreadId)).toBe(false);
  });

  it("keeps events owned by the selected thread", () => {
    expect(belongsToThread({ type: "codex.event", params: { threadId: "thread-1" } }, "thread-1")).toBe(true);
  });

  it("routes unscoped turn deltas through an already-known turn", () => {
    expect(belongsToThread({ params: { turnId: "turn-1", delta: "hello" } }, "thread-1", new Set(["turn-1"]))).toBe(true);
    expect(belongsToThread({ params: { turnId: "turn-other", delta: "no" } }, "thread-1", new Set(["turn-1"]))).toBe(false);
  });

  it("keeps optimistic turns when a late resume snapshot arrives", () => {
    const content = [{ type: "text", text: "Repeated prompt" }];
    const optimistic = { id: "local-turn-1", items: [{ id: "local-1", type: "userMessage", content }] };
    const persisted = { id: "persisted-old", items: [{ id: "old-user", type: "userMessage", content }] };
    const current = { id: "thread-1", turns: [persisted, optimistic] };
    const resumed = { id: "thread-1", name: "Fresh snapshot", turns: [persisted] };
    expect(mergeResumedThread(current, resumed)).toEqual({ ...resumed, turns: [...resumed.turns, optimistic] });
  });

  it("drops an optimistic turn once resume contains its persisted copy", () => {
    const content = [{ type: "text", text: "New prompt" }];
    const optimistic = { id: "local-turn-1", items: [{ id: "local-1", type: "userMessage", content }] };
    const persisted = { id: "persisted-new", items: [{ id: "new-user", type: "userMessage", content }] };
    const current = { id: "thread-1", turns: [optimistic] };
    const resumed = { id: "thread-1", turns: [persisted] };
    expect(mergeResumedThread(current, resumed)).toEqual(resumed);
  });
});
