import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { BrowserHub } from "../src/websocket/hub.js";

describe("BrowserHub approvals", () => {
  it("removes a pending request resolved by another app-server client", () => {
    const server = createServer();
    const supervisor = new EventEmitter() as any;
    supervisor.status = { state: "READY" };
    supervisor.broker = { respond() {} };
    const hub = new BrowserHub(server, supervisor, { projects: [] } as any);

    supervisor.emit("serverRequest", "daemon-request-1", "item/commandExecution/requestApproval", { threadId: "thread-1" });
    expect((hub as any).pending.size).toBe(1);
    supervisor.emit("notification", "serverRequest/resolved", { requestId: "daemon-request-1", threadId: "thread-1" });
    expect((hub as any).pending.size).toBe(0);
    hub.close();
  });
});
