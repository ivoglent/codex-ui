import { describe, expect, it } from "vitest";
import { activeTurnId, latestTurnLifecycle } from "./turn-state";

describe("activeTurnId", () => {
  it("uses the locally started turn until its completion event arrives", () => {
    const local = new Set(["turn-local"]);
    expect(activeTurnId([{ type: "codex.event", method: "turn/started", params: { turnId: "turn-local" } }], local)).toBe("turn-local");
    expect(activeTurnId([
      { type: "codex.event", method: "turn/started", params: { turnId: "turn-local" } },
      { type: "codex.event", method: "turn/completed", params: { turnId: "turn-local" } }
    ], local)).toBeUndefined();
  });

  it("recovers an in-progress turn from the resumed thread after a refresh", () => {
    expect(activeTurnId([], new Set(), [{ id: "turn-resumed", status: "inProgress" }, { id: "turn-old", status: "completed" }])).toBe("turn-resumed");
  });

  it("recognizes a completion even when the browser did not start the turn", () => {
    expect(latestTurnLifecycle([
      { type: "codex.event", method: "turn/started", params: { turnId: "turn-other" } },
      { type: "codex.event", method: "turn/completed", params: { turnId: "turn-other" } }
    ])).toBe("turn/completed");
  });
});
