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
});
