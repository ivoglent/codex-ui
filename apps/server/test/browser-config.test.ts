import { describe, expect, it } from "vitest";
import { notificationHubBrowserConfig } from "../src/notifications/browser-config.js";

describe("notificationHubBrowserConfig", () => {
  it("keeps Notification Hub disabled without a public Gateway URL", () => {
    expect(notificationHubBrowserConfig({}).publicConfig).toEqual({ enabled: false, baseUrl: null, service: "codex-control" });
  });

  it("exposes only the public Hub URL and service to the browser", () => {
    expect(notificationHubBrowserConfig({ NOTIFICATION_HUB_PUBLIC_URL: "https://notify.example.test/", NOTIFICATION_HUB_SERVICE: "codex-control" })).toEqual({
      publicConfig: { enabled: true, baseUrl: "https://notify.example.test", service: "codex-control" },
      cspConnectSource: "https://notify.example.test",
    });
  });

  it("rejects a malformed public URL instead of placing it in CSP", () => {
    expect(() => notificationHubBrowserConfig({ NOTIFICATION_HUB_PUBLIC_URL: "not a url" })).toThrow("absolute http(s) URL");
  });
});
