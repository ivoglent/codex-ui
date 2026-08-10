import { describe, expect, it } from "vitest";
import { belongsToThread } from "./thread-events";

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
});
