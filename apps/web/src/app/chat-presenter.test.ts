import { describe, expect, it } from "vitest";
import { buildChatItems, pickVisibleChat } from "./chat-presenter";

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

  it("presents image inputs without showing their data URLs as message text", () => {
    const image = "data:image/png;base64,c2NyZWVuc2hvdA==";
    const thread = { turns: [{ id: "turn-1", items: [{ id: "u1", type: "userMessage", content: [{ type: "text", text: "What is this?" }, { type: "image", url: image }] }] }] };
    expect(buildChatItems(thread, [])).toEqual([{ key: "item:u1", kind: "user", body: "What is this?", meta: { images: [image] } }]);
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

describe("pickVisibleChat", () => {
  const HISTORY_LIMIT = 160;

  function buildLongSession() {
    const priorTurns = Array.from({ length: 200 }, (_, index) => ({
      id: `turn-${index}`,
      status: "completed",
      items: [{ id: `u-${index}`, type: "userMessage", content: [{ type: "text", text: `prior ${index}` }] }]
    }));
    const latest = { id: "local-turn-latest", status: "inProgress", items: [{ id: "local-latest", type: "userMessage", content: [{ type: "text", text: "where did my bubble go?" }] }] };
    return { turns: [...priorTurns, latest] };
  }

  it("keeps the newest optimistic user message visible in a long session", () => {
    const thread = buildLongSession();
    const events = Array.from({ length: 200 }, (_, index) => ({ sequence: index + 1, method: "item/agentMessage/delta", params: { itemId: `delta-${index}`, delta: "x" } }));
    const chat = buildChatItems(thread, events);
    expect(chat.length).toBeGreaterThan(HISTORY_LIMIT);
    const naive = chat.slice(-HISTORY_LIMIT);
    expect(naive.some((item) => item.kind === "user")).toBe(false);
    const visible = pickVisibleChat(chat, HISTORY_LIMIT);
    const latestUser = [...visible].reverse().find((item) => item.kind === "user");
    expect(latestUser?.body).toBe("where did my bubble go?");
  });

  it("returns the full chat when it fits inside the limit", () => {
    const chat = buildChatItems(null, [
      { sequence: 1, method: "item/agentMessage/delta", params: { itemId: "a1", delta: "Hello " } },
      { sequence: 2, method: "item/agentMessage/delta", params: { itemId: "a1", delta: "world" } }
    ]);
    expect(pickVisibleChat(chat, HISTORY_LIMIT)).toHaveLength(1);
  });

  it("falls back to the trailing window when there is no outgoing message", () => {
    const events = Array.from({ length: HISTORY_LIMIT + 10 }, (_, index) => ({ sequence: index, method: "turn/plan/updated", params: { turnId: `t${index}`, plan: [] } }));
    const chat = buildChatItems(null, events);
    const visible = pickVisibleChat(chat, HISTORY_LIMIT);
    expect(visible).toHaveLength(HISTORY_LIMIT);
    expect(visible[visible.length - 1].key).toBe(`plan:t${HISTORY_LIMIT + 9}`);
  });

  it("treats a non-positive limit as a single item", () => {
    const chat = buildChatItems(null, [
      { sequence: 1, method: "turn/plan/updated", params: { turnId: "t1", plan: [] } },
      { sequence: 2, method: "turn/plan/updated", params: { turnId: "t2", plan: [] } }
    ]);
    expect(pickVisibleChat(chat, 0)).toHaveLength(1);
  });
});
