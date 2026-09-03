// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { NotificationHubService } from "./notification-hub.service";

const subscription = { toJSON: () => ({ endpoint: "https://push.example.test/subscription", keys: { p256dh: "public", auth: "auth" } }) };

describe("NotificationHubService", () => {
  it("registers this browser without sending a user id", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ enabled: true, baseUrl: "https://notify.example.test", service: "codex-control" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ applicationServerKey: "vapid-public-key" }), { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const subscribe = vi.fn().mockResolvedValue(subscription);
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: Promise.resolve({ pushManager: { subscribe } }) } });
    const service = new NotificationHubService();
    await service.enable();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/notification-hub/push/config");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/notification-hub/destinations/web-push");
    const body = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(body).toMatchObject({ endpoint: "https://push.example.test/subscription", service: "codex-control" });
    expect(body).not.toHaveProperty("userId");
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
  });
});
