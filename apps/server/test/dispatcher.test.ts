import { describe, expect, it } from "vitest";
import { shouldDispatchWebPush } from "../src/notifications/dispatcher.js";

describe("NotificationDispatcher", () => {
  it("does not turn account telemetry or system warnings into device pushes", () => {
    const item = (category: "account" | "system" | "approval" | "completed") => ({ id: category, category, priority: "normal" as const, method: "test", createdAt: "2026-08-25T00:00:00.000Z" });
    expect(shouldDispatchWebPush(item("account"))).toBe(false);
    expect(shouldDispatchWebPush(item("system"))).toBe(false);
    expect(shouldDispatchWebPush(item("approval"))).toBe(true);
    expect(shouldDispatchWebPush(item("completed"))).toBe(true);
  });
});
