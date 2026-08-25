import { describe, expect, it } from "vitest";
import { notificationThreadIdFromSearch } from "./notification-deep-link";

describe("notification session deep links", () => {
  it("reads the exact requested thread id", () => {
    expect(notificationThreadIdFromSearch("?threadId=thread-123&source=push")).toBe("thread-123");
  });

  it("rejects an absent or blank thread id", () => {
    expect(notificationThreadIdFromSearch("")).toBeNull();
    expect(notificationThreadIdFromSearch("?threadId=%20%20")).toBeNull();
  });
});
