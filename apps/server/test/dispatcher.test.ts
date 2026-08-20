import { describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { NotificationDispatcher } from "../src/notifications/dispatcher.js";
import { AttentionCoordinator } from "../src/notifications/attention.js";

describe("NotificationDispatcher", () => {
  it("returns null from fromEnv when env vars are missing", () => {
    const original = { ...process.env };
    delete process.env.NOTIFICATION_HUB_URL;
    delete process.env.NOTIFICATION_HUB_TOKEN;
    try {
      expect(NotificationDispatcher.fromEnv("test")).toBeNull();
    } finally {
      process.env = original;
    }
  });

  it("POSTs each attention item to /api/v1/events", async () => {
    const recorded: Array<{ method: string; url: string; headers: Record<string, string>; body: string }> = [];
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          if (typeof value === "string") headers[key] = value;
        }
        recorded.push({
          method: req.method ?? "GET",
          url: req.url ?? "/",
          headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
        res.statusCode = 202;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ eventId: "evt-1", status: "accepted" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const dispatcher = new NotificationDispatcher({ baseUrl, token: "secret", service: "codex-control" });
    const coordinator = new AttentionCoordinator();
    dispatcher.attach(coordinator);

    coordinator.add("item/commandExecution/requestApproval", { threadId: "t-1", turnId: "v-1" });
    coordinator.add("turn/completed", { threadId: "t-1", turnId: "v-1" });

    await waitFor(() => recorded.length >= 2);

    expect(recorded).toHaveLength(2);
    expect(recorded[0].method).toBe("POST");
    expect(recorded[0].url).toBe("/api/v1/events");
    expect(recorded[0].headers.authorization).toBe("Bearer secret");
    expect(recorded[0].headers["content-type"]).toBe("application/json");
    const approval = JSON.parse(recorded[0].body) as { type: string; category: string; severityHint: string; dedupKey: string };
    expect(approval.category).toBe("approval");
    expect(approval.severityHint).toBe("warning");
    expect(approval.type).toBe("codex.attention.approval");
    expect(approval.dedupKey).toMatch(/^codex-control:/);

    const completed = JSON.parse(recorded[1].body) as { category: string };
    expect(completed.category).toBe("completed");

    server.close();
  });

  it("does not double-dispatch duplicate items", async () => {
    const recorded: string[] = [];
    const server = createServer((_req, res) => {
      recorded.push("hit");
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ status: "ok" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const dispatcher = new NotificationDispatcher({ baseUrl: `http://127.0.0.1:${port}`, token: "secret" });
    const coordinator = new AttentionCoordinator();
    dispatcher.attach(coordinator);

    coordinator.add("turn/completed", { threadId: "t-1", turnId: "v-1" });
    coordinator.add("turn/completed", { threadId: "t-1", turnId: "v-1" });
    await waitFor(() => recorded.length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recorded).toHaveLength(1);
    server.close();
  });

  it("ignores items without an attention category", async () => {
    const recorded: string[] = [];
    const server = createServer((_req, res) => {
      recorded.push("hit");
      res.statusCode = 200;
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const dispatcher = new NotificationDispatcher({ baseUrl: `http://127.0.0.1:${port}`, token: "secret" });
    const coordinator = new AttentionCoordinator();
    dispatcher.attach(coordinator);
    coordinator.add("thread/started", { thread: { id: "t-1" } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recorded).toEqual([]);
    server.close();
  });

  it("surfaces hub rejections via onOutcome", async () => {
    const server = createServer((_req, res) => {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: { message: "downstream offline" } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const onOutcome = vi.fn();
    const dispatcher = new NotificationDispatcher({ baseUrl: `http://127.0.0.1:${port}`, token: "secret" }, { onOutcome });
    const coordinator = new AttentionCoordinator();
    dispatcher.attach(coordinator);
    coordinator.add("turn/completed", { threadId: "t-1", turnId: "v-1" });
    await waitFor(() => onOutcome.mock.calls.length > 0);
    const calls = onOutcome.mock.calls as Array<[unknown, { accepted: boolean; status: number; error?: string }]>;
    const outcome = calls[0][1];
    expect(outcome.accepted).toBe(false);
    expect(outcome.status).toBe(502);
    expect(outcome.error).toBe("downstream offline");
    server.close();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
