import { describe, expect, test } from "vitest";
import { PULL_MAX_PX, PULL_RESISTANCE, PULL_THRESHOLD_PX, indicatorOffset, pullDistance, shouldCommitRefresh } from "./pull-refresh";

describe("pull-refresh geometry", () => {
  test("pullDistance returns 0 for non-positive deltas", () => {
    expect(pullDistance(0)).toBe(0);
    expect(pullDistance(-10)).toBe(0);
    expect(pullDistance(Number.NaN)).toBe(0);
  });

  test("pullDistance applies the resistance coefficient below the cap", () => {
    expect(pullDistance(20)).toBeCloseTo(20 * PULL_RESISTANCE);
    expect(pullDistance(100)).toBeCloseTo(100 * PULL_RESISTANCE);
  });

  test("pullDistance caps at the maximum travel", () => {
    expect(pullDistance(500)).toBe(PULL_MAX_PX);
  });

  test("shouldCommitRefresh only fires once the distance passes the threshold", () => {
    expect(shouldCommitRefresh(PULL_THRESHOLD_PX - 1)).toBe(false);
    expect(shouldCommitRefresh(PULL_THRESHOLD_PX)).toBe(true);
    expect(shouldCommitRefresh(PULL_MAX_PX)).toBe(true);
    expect(shouldCommitRefresh(Number.NaN)).toBe(false);
  });

  test("indicatorOffset aligns the bottom of the bar with the top of the scroll container at rest", () => {
    expect(indicatorOffset(0)).toBe(-56);
    expect(indicatorOffset(PULL_THRESHOLD_PX)).toBe(PULL_THRESHOLD_PX - 56);
    expect(indicatorOffset(PULL_MAX_PX)).toBe(PULL_MAX_PX - 56);
  });
});
