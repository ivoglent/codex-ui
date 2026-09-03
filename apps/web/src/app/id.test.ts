import { describe, expect, it } from "vitest";
import { createId, extractTurnId } from "./id";

describe("createId", () => {
  it("creates distinct UUID-shaped identifiers", () => {
    const first = createId();
    const second = createId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).not.toBe(first);
  });
});

describe("extractTurnId", () => {
  it("returns the id from a directly-returned turn object", () => {
    expect(extractTurnId({ id: "turn-direct", items: [], status: "inProgress", error: null })).toBe("turn-direct");
  });

  it("returns the id from a turn wrapped in { turn: { id } }", () => {
    // The codex app-server has historically returned turns in both shapes; the
    // scheduler and the PWA composer must accept either to avoid losing track
    // of locally-started turns.
    expect(extractTurnId({ turn: { id: "turn-wrapped", items: [], status: "inProgress", error: null } })).toBe("turn-wrapped");
  });

  it("returns undefined for missing or malformed results", () => {
    expect(extractTurnId(undefined)).toBeUndefined();
    expect(extractTurnId(null)).toBeUndefined();
    expect(extractTurnId({})).toBeUndefined();
    expect(extractTurnId({ turn: {} })).toBeUndefined();
    expect(extractTurnId({ id: 42 })).toBeUndefined();
    expect(extractTurnId({ turn: { id: 42 } })).toBeUndefined();
  });
});
