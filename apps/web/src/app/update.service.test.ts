// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Subject } from "rxjs";
import { AppUpdater, UpdateService } from "./update.service";
import { BUNDLE_VERSION } from "./bundle-version.generated";

const makeUpdater = (): AppUpdater & { activateUpdate: ReturnType<typeof vi.fn>; versionUpdates: Subject<{ type: string }> } => {
  const subject = new Subject<{ type: string }>();
  return { isEnabled: true, versionUpdates: subject, activateUpdate: vi.fn().mockResolvedValue(true) };
};

const installFetchStub = (responder: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response) => {
  const original = (globalThis as any).fetch;
  (globalThis as any).fetch = vi.fn((input, init) => Promise.resolve(responder(input as RequestInfo | URL, init)));
  return () => { (globalThis as any).fetch = original; };
};

const stubReload = () => {
  const reload = vi.fn();
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
  return reload;
};

const setVisibilityState = (state: "visible" | "hidden") => {
  const original = Object.getOwnPropertyDescriptor(window.document, "visibilityState");
  Object.defineProperty(window.document, "visibilityState", { configurable: true, get: () => state });
  return { restore: () => { if (original) Object.defineProperty(window.document, "visibilityState", original); else delete (window.document as unknown as Record<string, unknown>).visibilityState; } };
};

interface NotificationStub {
  instances: { title: string; options?: NotificationOptions }[];
  restore: () => void;
}

const stubNotification = ({ permission }: { permission: NotificationPermission }): NotificationStub => {
  const instances: { title: string; options?: NotificationOptions }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Ctor: any = function NotificationStub(title: string, options?: NotificationOptions) { instances.push({ title, options }); };
  Ctor.permission = permission;
  Ctor.requestPermission = vi.fn().mockResolvedValue(permission);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Notification = Ctor;
  return { instances, restore: () => { delete (globalThis as any).Notification; } };
};


describe("UpdateService", () => {
  let restoreFetch: () => void;

  beforeEach(() => {
    restoreFetch = () => {};
    // Reset the persisted dismissal marker between tests so a stale value
    // does not leak between scenarios.
    try { window.localStorage.removeItem(UpdateService.DISMISSED_KEY); } catch { /* ignore */ }
  });

  afterEach(() => {
    restoreFetch();
    vi.restoreAllMocks();
  });

  it("exposes the bundle version baked at build time", () => {
    restoreFetch = installFetchStub(() => new Response("{}", { status: 200 }));
    const service = new UpdateService();
    expect(service.currentVersion).toBe(BUNDLE_VERSION);
  });

  it("hydrates the running version from /api/version on construction", async () => {
    restoreFetch = installFetchStub(() => new Response(JSON.stringify({ application: "v9.9.9", commit: "abc1234", node: "v20.0.0", codex: "1.2.3", generatedProtocol: "1.2.3", compatible: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const service = new UpdateService();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.running()?.application).toBe("v9.9.9");
    expect(service.running()?.commit).toBe("abc1234");
  });

  it("flags an available update when the server version differs from the bundle", async () => {
    restoreFetch = installFetchStub(() => new Response(JSON.stringify({ application: "v9.9.9", commit: "abc1234", node: "v20.0.0", codex: "1.2.3", generatedProtocol: "1.2.3", compatible: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const service = new UpdateService();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.available()?.version).toBe("v9.9.9");
    expect(service.available()?.commit).toBe("abc1234");
  });

  it("does not flag an update when the bundle matches the server version", async () => {
    restoreFetch = installFetchStub(() => new Response(JSON.stringify({ application: BUNDLE_VERSION, commit: null, node: "v20.0.0", codex: "1.2.3", generatedProtocol: "1.2.3", compatible: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const service = new UpdateService();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.available()).toBeNull();
  });

  it("reacts to VERSION_READY by re-fetching /api/version", async () => {
    let call = 0;
    restoreFetch = installFetchStub(() => {
      call += 1;
      // First two fetches run during construction/bind and observe the
      // current bundle version. The VERSION_READY handler triggers a third
      // fetch that exposes the new server build.
      const application = call <= 2 ? BUNDLE_VERSION : "v9.9.9";
      return new Response(JSON.stringify({ application, commit: "abc1234", node: "v20.0.0", codex: "1.2.3", generatedProtocol: "1.2.3", compatible: true }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const updater = makeUpdater();
    const service = new UpdateService();
    service.bind(updater);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(call).toBe(2);
    expect(service.available()).toBeNull();
    updater.versionUpdates.next({ type: "VERSION_READY" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(call).toBeGreaterThanOrEqual(3);
    expect(service.available()?.version).toBe("v9.9.9");
  });

  it("applies the pending update by activating the worker and reloading", async () => {
    restoreFetch = installFetchStub(() => new Response("{}", { status: 200 }));
    const reload = stubReload();
    const updater = makeUpdater();
    const service = new UpdateService();
    service.bind(updater);
    service.available.set({ version: "v9.9.9", commit: null });
    await service.applyUpdate();
    expect(updater.activateUpdate).toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
    expect(service.available()).toBeNull();
  });

  it("dismisses the update notification without reloading", () => {
    restoreFetch = installFetchStub(() => new Response("{}", { status: 200 }));
    const reload = stubReload();
    const updater = makeUpdater();
    const service = new UpdateService();
    service.bind(updater);
    service.available.set({ version: "v9.9.9", commit: null });
    service.dismiss();
    expect(service.available()).toBeNull();
    expect(reload).not.toHaveBeenCalled();
    expect(updater.activateUpdate).not.toHaveBeenCalled();
  });

  it("persists the dismissed version so polling does not reflash the same banner", async () => {
    restoreFetch = installFetchStub(() => new Response(JSON.stringify({ application: "v9.9.9", commit: "abc1234", node: "v20.0.0", codex: "1.2.3", generatedProtocol: "1.2.3", compatible: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const updater = makeUpdater();
    const first = new UpdateService();
    first.bind(updater);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(first.available()?.version).toBe("v9.9.9");
    first.dismiss();
    expect(first.available()).toBeNull();
    expect(window.localStorage.getItem(UpdateService.DISMISSED_KEY)).toBe("v9.9.9");
    // A second polling refresh on the same instance must not bring the banner back.
    await first.refresh();
    expect(first.available()).toBeNull();
  });

  it("hides a residual banner when the bundle catches up with the server", async () => {
    restoreFetch = installFetchStub(() => new Response(JSON.stringify({ application: BUNDLE_VERSION, commit: null, node: "v20.0.0", codex: "1.2.3", generatedProtocol: "1.2.3", compatible: true }), { status: 200, headers: { "content-type": "application/json" } }));
    // Pretend a previous version was dismissed so we can confirm it is cleared
    // once the server's reported build matches the bundle.
    window.localStorage.setItem(UpdateService.DISMISSED_KEY, "v9.9.9");
    const updater = makeUpdater();
    const service = new UpdateService();
    service.bind(updater);
    service.available.set({ version: "v9.9.9", commit: null });
    await service.refresh();
    expect(service.available()).toBeNull();
    expect(window.localStorage.getItem(UpdateService.DISMISSED_KEY)).toBeNull();
  });

  it("fires a system notification when an update becomes available and the tab is hidden", async () => {
    restoreFetch = installFetchStub(() => new Response(JSON.stringify({ application: "v9.9.9", commit: "abc1234", node: "v20.0.0", codex: "1.2.3", generatedProtocol: "1.2.3", compatible: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const visibility = setVisibilityState("hidden");
    const notification = stubNotification({ permission: "granted" });
    try {
      const service = new UpdateService();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(service.available()?.version).toBe("v9.9.9");
      expect(notification.instances).toHaveLength(1);
      expect(notification.instances[0].title).toBe("Codex Control v9.9.9 ready");
      expect(notification.instances[0].options.tag).toBe(`${UpdateService.NOTIFICATION_TAG_PREFIX}v9.9.9`);
    } finally {
      visibility.restore();
      notification.restore();
    }
  });

  it("does not fire a system notification while the tab is visible", async () => {
    restoreFetch = installFetchStub(() => new Response(JSON.stringify({ application: "v9.9.9", commit: "abc1234", node: "v20.0.0", codex: "1.2.3", generatedProtocol: "1.2.3", compatible: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const visibility = setVisibilityState("visible");
    const notification = stubNotification({ permission: "granted" });
    try {
      const service = new UpdateService();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(service.available()?.version).toBe("v9.9.9");
      expect(notification.instances).toHaveLength(0);
    } finally {
      visibility.restore();
      notification.restore();
    }
  });

  it("does not fire a system notification when browser permission is not granted", async () => {
    restoreFetch = installFetchStub(() => new Response(JSON.stringify({ application: "v9.9.9", commit: "abc1234", node: "v20.0.0", codex: "1.2.3", generatedProtocol: "1.2.3", compatible: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const visibility = setVisibilityState("hidden");
    const notification = stubNotification({ permission: "default" });
    try {
      const service = new UpdateService();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(notification.instances).toHaveLength(0);
    } finally {
      visibility.restore();
      notification.restore();
    }
  });

  it("does not fire twice for the same version across repeated refreshes", async () => {
    restoreFetch = installFetchStub(() => new Response(JSON.stringify({ application: "v9.9.9", commit: "abc1234", node: "v20.0.0", codex: "1.2.3", generatedProtocol: "1.2.3", compatible: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const visibility = setVisibilityState("hidden");
    const notification = stubNotification({ permission: "granted" });
    try {
      const service = new UpdateService();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await service.refresh();
      await service.refresh();
      expect(notification.instances).toHaveLength(1);
    } finally {
      visibility.restore();
      notification.restore();
    }
  });

  it("does not fire when the version has already been dismissed this session", async () => {
    window.localStorage.setItem(UpdateService.DISMISSED_KEY, "v9.9.9");
    restoreFetch = installFetchStub(() => new Response(JSON.stringify({ application: "v9.9.9", commit: "abc1234", node: "v20.0.0", codex: "1.2.3", generatedProtocol: "1.2.3", compatible: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const visibility = setVisibilityState("hidden");
    const notification = stubNotification({ permission: "granted" });
    try {
      const service = new UpdateService();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(service.available()).toBeNull();
      expect(notification.instances).toHaveLength(0);
    } finally {
      visibility.restore();
      notification.restore();
    }
  });
});
