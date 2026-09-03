import { describe, expect, it } from "vitest";
import { EventStream } from "../src/websocket/event-stream.js";
describe("EventStream", () => {
  it("replays in order and requests resync after buffer expiry", () => { const stream = new EventStream(2); stream.append("a", {}); stream.append("b", {}); stream.append("c", {}); expect(stream.replay(stream.generationId, 0)).toBeNull(); expect(stream.replay(stream.generationId, 1)?.map((event) => event.type)).toEqual(["b", "c"]); expect(stream.replay(stream.generationId, 2)?.map((event) => event.type)).toEqual(["c"]); expect(stream.replay("old", 0)).toBeNull(); });
  it("assigns monotonic sequences", () => { const stream = new EventStream(); expect(stream.append("a", {}).sequence).toBe(1); expect(stream.append("b", {}).sequence).toBe(2); });
});
