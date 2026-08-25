import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { proxyNotificationHub } from "../src/notifications/hub-proxy.js";

describe("proxyNotificationHub", () => {
  const servers: ReturnType<typeof createServer>[] = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))); });

  it("forwards the opaque cookie without browser CORS", async () => {
    let received: { cookie?: string; body?: string } = {};
    const server = createServer((request, response) => { let body = ""; request.on("data", chunk => body += chunk); request.on("end", () => { received = { cookie: request.headers.cookie, body }; response.writeHead(201, { "content-type": "application/json" }).end("{\"id\":1}"); }); });
    servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    await expect(proxyNotificationHub(`http://127.0.0.1:${address.port}`, "/api/v1/me/destinations/web-push", "opaque-cookie", "POST", "{\"endpoint\":\"https://push.example\"}")).resolves.toMatchObject({ status: 201, body: "{\"id\":1}" });
    expect(received).toEqual({ cookie: "access_token=opaque-cookie", body: "{\"endpoint\":\"https://push.example\"}" });
  });
});
