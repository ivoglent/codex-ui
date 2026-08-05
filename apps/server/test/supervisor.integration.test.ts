import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { AppServerSupervisor } from "../src/codex/supervisor.js";

const fake = fileURLToPath(new URL("fixtures/fake-app-server.mjs", import.meta.url));
const createSupervisor = () => new AppServerSupervisor({ executable: process.execPath, args: [fake], requestTimeoutMs: 200, restart: { enabled: false, minDelayMs: 1, maxDelayMs: 1, maxRestartsPerMinute: 1 } });

describe("AppServerSupervisor", () => {
  it("handshakes and supports phase-zero RPCs", async () => {
    const supervisor = createSupervisor(); const notification = vi.fn(); supervisor.on("notification", notification);
    await supervisor.start();
    expect(supervisor.status.state).toBe("READY");
    expect(await supervisor.broker.request("model/list", {})).toMatchObject({ data: [{ id: "fake-model" }] });
    expect(await supervisor.broker.request("thread/list", {})).toMatchObject({ data: [] });
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
});
