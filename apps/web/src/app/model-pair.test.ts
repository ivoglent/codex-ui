import { describe, expect, it } from "vitest";
import { modelPairKey } from "./model-pair";

describe("modelPairKey", () => {
  it("creates a native-select-safe, unambiguous key", () => {
    const key = modelPairKey("MiniMax-M3", "minimax");

    expect(key).not.toContain("\u0000");
    expect(JSON.parse(key)).toEqual(["minimax", "MiniMax-M3"]);
    expect(modelPairKey("c", "a|b")).not.toBe(modelPairKey("b|c", "a"));
  });
});
