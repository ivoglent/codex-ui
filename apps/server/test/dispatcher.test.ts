import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { accessTokenFromCookie, NotificationDispatcher, shouldDispatchWebPush } from "../src/notifications/dispatcher.js";

describe("NotificationDispatcher", () => {
  const servers: ReturnType<typeof createServer>[] = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => server.close(() => resolve())))); });

  it("forwards the session cookie to Gateway without a bearer header", async () => {
    let received: { url?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown } = {};
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", chunk => body += chunk);
      request.on("end", () => { received = { url: request.url, headers: request.headers, body: JSON.parse(body) }; response.writeHead(201).end("{}"); });
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const dispatcher = new NotificationDispatcher({ baseUrl: `http://127.0.0.1:${address.port}`, service: "codex-control" });

    await expect(dispatcher.dispatch({ id: "attention-1", category: "approval", priority: "high", method: "item/commandExecution/requestApproval", threadId: "thread-1", createdAt: "2026-08-25T00:00:00.000Z" }, "opaque-user-cookie")).resolves.toMatchObject({ accepted: true, status: 201 });

    expect(received.url).toBe("/api/v1/notifications/publish");
    expect(received.headers?.cookie).toBe("access_token=opaque-user-cookie");
    expect(received.headers).not.toHaveProperty("authorization");
    expect(received.body).toMatchObject({ service: "codex-control", title: "Codex is asking for approval", context: { attentionId: "attention-1", threadId: "thread-1", severity: "WARNING" } });
  });

  it("extracts only a safe access_token cookie value", () => {
    expect(accessTokenFromCookie("theme=dark; access_token=opaque-token; locale=en")).toBe("opaque-token");
    expect(accessTokenFromCookie("theme=dark")).toBeNull();
    expect(accessTokenFromCookie("access_token=bad\r\nInjected: value")).toBeNull();
  });

  it("does not turn account telemetry or system warnings into device pushes", () => {
    const item = (category: "account" | "system" | "approval" | "completed") => ({ id: category, category, priority: "normal" as const, method: "test", createdAt: "2026-08-25T00:00:00.000Z" });
    expect(shouldDispatchWebPush(item("account"))).toBe(false);
    expect(shouldDispatchWebPush(item("system"))).toBe(false);
    expect(shouldDispatchWebPush(item("approval"))).toBe(true);
    expect(shouldDispatchWebPush(item("completed"))).toBe(true);
  });
});
