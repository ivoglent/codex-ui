import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { AppServerSupervisor } from "../src/codex/supervisor.js";

const fake = fileURLToPath(new URL("fixtures/fake-app-server.mjs", import.meta.url));
const createSupervisor = () => new AppServerSupervisor({ executable: process.execPath, args: [fake], requestTimeoutMs: 200, restart: { enabled: false, minDelayMs: 1, maxDelayMs: 1, maxRestartsPerMinute: 1 } });

describe("AppServerSupervisor", () => {
  it("handshakes and supports phase-zero RPCs", async () => {
    const supervisor = createSupervisor(); const notification = vi.fn(); supervisor.on("notification", notification);
    await supervisor.start();
    expect(supervisor.status.state).toBe("READY");
    expect(await supervisor.broker.request("model/list", {})).toMatchObject({ data: [{ id: "fake-model" }] });
    const listed = await supervisor.broker.request<{ data: Array<{ id: string }> }>("thread/list", {});
    expect(listed.data.map((thread) => thread.id)).toEqual([
      "thread-existing",
      "thread-approval",
      "thread-terminal-approval",
      "thread-parent-workspace",
      "thread-long-title"
    ]);
    const started = await supervisor.broker.request<{ thread: { id: string } }>("thread/start", { cwd: process.cwd() });
    const turn = await supervisor.broker.request<{ turn: { id: string } }>("turn/start", { threadId: started.thread.id, input: [{ type: "text", text: "hello", text_elements: [] }] });
    expect(turn.turn.id).toBe("turn-1"); expect(notification).toHaveBeenCalled();
    await supervisor.stop(); expect(supervisor.status.state).toBe("STOPPED");
  });

  it("surfaces unknown server requests without resolving them", async () => {
    const supervisor = createSupervisor(); const request = vi.fn(); supervisor.on("serverRequest", request); await supervisor.start();
    await expect(supervisor.broker.request("test/serverRequest")).rejects.toThrow("timed out");
    expect(request).toHaveBeenCalledWith("server-1", "item/commandExecution/requestApproval", { command: "true" });
    await supervisor.stop();
  });

  it("uses WebSocket framing through a byte-stream proxy", async () => {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const address = wss.address();
    if (!address || typeof address === "string") throw new Error("WebSocket test server has no TCP port");
    wss.on("connection", (socket) => socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as { id?: number; method: string };
      if (message.method === "initialize") socket.send(JSON.stringify({ id: message.id, result: { userAgent: "fake-proxy/1" } }));
      if (message.method === "model/list") socket.send(JSON.stringify({ id: message.id, result: { data: [{ id: "shared-model" }] } }));
    }));
    const proxy = fileURLToPath(new URL("fixtures/fake-byte-proxy.mjs", import.meta.url));
    const supervisor = new AppServerSupervisor({
      executable: process.execPath,
      args: [proxy, String(address.port)],
      transport: "websocket",
      restart: { enabled: false, minDelayMs: 1, maxDelayMs: 1, maxRestartsPerMinute: 1 }
    });
    try {
      await supervisor.start();
      expect(supervisor.status.state).toBe("READY");
      expect(await supervisor.broker.request("model/list", {})).toMatchObject({ data: [{ id: "shared-model" }] });
    } finally {
      await supervisor.stop();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
  });
});
