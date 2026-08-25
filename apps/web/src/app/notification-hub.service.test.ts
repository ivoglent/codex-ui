// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { of } from "rxjs";
import { NotificationHubService } from "./notification-hub.service";

const subscription = {
  toJSON: () => ({ endpoint: "https://push.example.test/subscription", keys: { p256dh: "public", auth: "auth" } }),
};

describe("NotificationHubService", () => {
  it("registers this browser without sending a user id", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ enabled: true, baseUrl: "https://notify.example.test", service: "codex-control" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ applicationServerKey: "vapid-public-key" }), { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new NotificationHubService({ isEnabled: true, subscription: of(null), requestSubscription: vi.fn().mockResolvedValue(subscription) } as any);
    await service.enable();
    expect(fetchMock.mock.calls[2][0]).toBe("https://notify.example.test/api/v1/me/destinations/web-push");
    const body = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(body).toMatchObject({ endpoint: "https://push.example.test/subscription", service: "codex-control" });
    expect(body).not.toHaveProperty("userId");
  });

  it("publishes an attention item through the user-bound publish endpoint once", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ enabled: true, baseUrl: "https://notify.example.test", service: "codex-control" }), { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new NotificationHubService({ isEnabled: false, subscription: of(null) } as any);
    await service.publishAttention({ id: "a-1", category: "approval", priority: "high", method: "requestApproval", threadId: "t-1" });
    await service.publishAttention({ id: "a-1", category: "approval", priority: "high", method: "requestApproval", threadId: "t-1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("https://notify.example.test/api/v1/notifications/publish");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ service: "codex-control", title: "Codex is asking for approval", context: { attentionId: "a-1", threadId: "t-1" } });
  });
});
