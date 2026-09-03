import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { RpcBroker, RpcError } from "../src/codex/rpc-broker.js";

describe("RpcBroker", () => {
  it("correlates responses and forwards notifications and server requests", async () => {
    const writer = new PassThrough(); const broker = new RpcBroker(writer, 100); const serverRequest = vi.fn(); const notification = vi.fn();
    broker.on("serverRequest", serverRequest); broker.on("notification", notification);
    const pending = broker.request("model/list", {}); broker.accept({ id: 1, result: { data: [] } });
    expect(await pending).toEqual({ data: [] });
    broker.accept({ method: "turn/completed", params: { ok: true } });
    broker.accept({ id: "server-1", method: "approval", params: {} });
    expect(notification).toHaveBeenCalledWith({ method: "turn/completed", params: { ok: true } });
    expect(serverRequest).toHaveBeenCalledWith({ id: "server-1", method: "approval", params: {} });
  });

  it("times out and clears pending requests", async () => {
    const broker = new RpcBroker(new PassThrough(), 5);
    await expect(broker.request("slow")).rejects.toBeInstanceOf(RpcError);
    expect(broker.pendingCount).toBe(0);
  });

  it("fails pending calls after process exit", async () => {
    const broker = new RpcBroker(new PassThrough()); const pending = broker.request("model/list");
    broker.failAll(new Error("exited")); await expect(pending).rejects.toThrow("exited");
  });
});
