import { describe, expect, it } from "vitest";
import { buildChatItems } from "./chat-presenter";

describe("buildChatItems", () => {
  it("turns persisted protocol items into a useful conversation", () => {
    const thread = { turns: [{ id: "turn-1", status: "completed", items: [
      { id: "u1", type: "userMessage", content: [{ type: "text", text: "Fix the tests" }] },
      { id: "a1", type: "agentMessage", text: "The tests are fixed." },
      { id: "c1", type: "commandExecution", command: "pnpm test", aggregatedOutput: "21 passed", status: "completed" }
    ] }] };
    expect(buildChatItems(thread, [])).toMatchObject([
      { kind: "user", body: "Fix the tests" },
      { kind: "assistant", body: "The tests are fixed." },
      { kind: "command", title: "pnpm test", body: "21 passed" }
    ]);
  });

  it("coalesces streaming assistant deltas", () => {
    const events: any[] = [
      { sequence: 1, method: "item/agentMessage/delta", params: { itemId: "a1", delta: "Hello " } },
      { sequence: 2, method: "item/agentMessage/delta", params: { itemId: "a1", delta: "world" } }
    ];
    expect(buildChatItems(null, events)).toEqual([{ key: "delta:a1", kind: "assistant", body: "Hello world" }]);
  });

  it("reconciles an optimistic user message with the persisted item", () => {
    const thread = { turns: [{ id: "local-turn", items: [{ id: "local-1", type: "userMessage", content: [{ type: "text", text: "Continue the work" }] }] }] };
    const events: any[] = [{ sequence: 1, method: "item/completed", params: { item: { id: "persisted-1", type: "userMessage", content: [{ type: "text", text: "Continue the work" }] } } }];
    expect(buildChatItems(thread, events)).toEqual([{ key: "item:persisted-1", kind: "user", body: "Continue the work" }]);
  });

  it("updates a plan in place instead of appending duplicates", () => {
    const events: any[] = [
      { sequence: 1, method: "turn/plan/updated", params: { turnId: "t1", plan: [{ step: "Read files", status: "completed" }] } },
      { sequence: 2, method: "turn/plan/updated", params: { turnId: "t1", plan: [{ step: "Read files", status: "completed" }, { step: "Build", status: "inProgress" }] } }
    ];
    expect(buildChatItems(null, events)).toEqual([{ key: "plan:t1", kind: "plan", title: "Plan", body: "", meta: { steps: events[1].params.plan } }]);
  });

  it("merges duplicate file-change events for a turn", () => {
    const thread = { turns: [{ id: "t1", items: [
      { id: "f1", type: "fileChange", changes: [{ path: "a.ts", kind: "modified" }] },
      { id: "f2", type: "fileChange", changes: [{ path: "b.ts", kind: "added" }, { path: "a.ts", kind: "modified" }] }
    ] }] };
    const items = buildChatItems(thread, []);
    expect(items).toHaveLength(1);
    expect(items[0].meta.changes).toEqual([{ path: "a.ts", kind: "modified" }, { path: "b.ts", kind: "added" }]);
  });

  it("accepts structured change kinds from the app server", () => {
    const thread = { turns: [{ id: "t1", items: [{ id: "f1", type: "fileChange", changes: [{ path: "old.ts", kind: { type: "deleted" } }] }] }] };
    expect(buildChatItems(thread, [])[0].meta.changes[0].kind).toEqual({ type: "deleted" });
  });
});
