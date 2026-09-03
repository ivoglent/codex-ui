import { describe, expect, it, vi } from "vitest";
import { JsonlFramer } from "../src/codex/jsonl-framer.js";

describe("JsonlFramer", () => {
  it("frames partial and multiple lines", () => {
    const framer = new JsonlFramer(); const seen: unknown[] = [];
    framer.on("message", (message) => seen.push(message));
    framer.push('{"id":1,"res'); framer.push('ult":{}}\n{"method":"ready"}\n');
    expect(seen).toEqual([{ id: 1, result: {} }, { method: "ready" }]);
  });

  it("recovers after malformed input", () => {
    const framer = new JsonlFramer(); const malformed = vi.fn(); const seen: unknown[] = [];
    framer.on("malformed", malformed); framer.on("message", (message) => seen.push(message));
    framer.push('bad\n{"method":"still/alive"}\n');
    expect(malformed).toHaveBeenCalledOnce(); expect(seen).toEqual([{ method: "still/alive" }]);
  });
});
