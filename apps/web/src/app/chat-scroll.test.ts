import { describe, expect, it } from "vitest";
import { distanceFromBottom, isNearBottom, meaningfulUpdateDelta } from "./chat-scroll";

describe("chat scroll state", () => {
  it("uses the 120px near-bottom threshold and sentinel visibility", () => {
    expect(distanceFromBottom(1200, 980, 100)).toBe(120);
    expect(isNearBottom(1200, 980, 100)).toBe(true);
    expect(isNearBottom(1200, 500, 100)).toBe(false);
    expect(isNearBottom(1200, 0, 100, true)).toBe(true);
  });

  it("counts only meaningful item additions, not streaming mutations", () => {
    expect(meaningfulUpdateDelta(4, 4)).toBe(0);
    expect(meaningfulUpdateDelta(4, 5)).toBe(1);
    expect(meaningfulUpdateDelta(5, 3)).toBe(0);
  });
});
