import { describe, expect, it, vi } from "vitest";
import { NotificationService } from "./notification.service";

describe("NotificationService", () => {
  it("uses the backend-owned Web Push endpoints", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ enabled: true, applicationServerKey: "key" }) })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("Notification", { permission: "default" });
    const service = new NotificationService(); await service.initialize();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/notifications/config");
    expect(service.state()).toBe("ready");
  });
});
