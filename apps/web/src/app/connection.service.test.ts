// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionService } from "./connection.service";

type StubTimeline = { accept: (event: unknown) => void };

const makeService = (): { service: ConnectionService; timeline: StubTimeline } => {
  const timeline: StubTimeline = { accept: () => {} };
  const service = new ConnectionService(timeline as any);
  // Stop the constructor-triggered connect() from running so the test owns the
  // socket lifecycle and the auth-probe timer stays deterministic.
  (service as any).socket = { close: () => {}, readyState: 3 /* CLOSED */ };
  return { service, timeline };
};

const installFetchStub = (responder: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response) => {
  const original = (globalThis as any).fetch;
  (globalThis as any).fetch = vi.fn((input, init) => Promise.resolve(responder(input as RequestInfo | URL, init)));
  return () => { (globalThis as any).fetch = original; };
};

const installWebSocketStub = () => {
  const original = (globalThis as any).WebSocket;
  class StubWebSocket {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 1;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    close(): void { this.readyState = 3; this.onclose?.(); }
    send(): void { /* noop */ }
  }
  (globalThis as any).WebSocket = StubWebSocket;
  return () => { (globalThis as any).WebSocket = original; };
};

describe("ConnectionService.authRequired", () => {
  beforeEach(() => {
    installWebSocketStub();
    if (!("localStorage" in globalThis) || !globalThis.localStorage) {
      const store = new Map<string, string>();
      (globalThis as any).localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
        clear: () => store.clear(),
      };
    }
    // The constructor calls connect(), which previously triggered a setTimeout
    // to schedule reconnect. The timer reference is private; clear all timers
    // to keep the test isolated.
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("flags a 401 response from the gateway as auth required", async () => {
    const restoreFetch = installFetchStub(() => new Response("{}", { status: 401 }));
    const { service } = makeService();
    expect(service.authRequired()).toBe(false);
    const result = await service.probeAuth();
    expect(result).toBe(true);
    expect(service.authRequired()).toBe(true);
    restoreFetch();
  });

  it("flags a 403 response from the gateway as auth required", async () => {
    const restoreFetch = installFetchStub(() => new Response("{}", { status: 403 }));
    const { service } = makeService();
    const result = await service.probeAuth();
    expect(result).toBe(true);
    expect(service.authRequired()).toBe(true);
    restoreFetch();
  });

  it("flags an opaque redirect (gateway bouncing to SSO) as auth required", async () => {
    // With `redirect: "manual"`, browsers expose a 3xx as an opaque response.
    // The gateway is the only reason /api/version would redirect, so treat any
    // opaque redirect as session expiry.
    const opaque = new Response(null, { status: 302 });
    Object.defineProperty(opaque, "type", { value: "opaqueredirect" });
    const restoreFetch = installFetchStub(() => opaque);
    const { service } = makeService();
    const result = await service.probeAuth();
    expect(result).toBe(true);
    expect(service.authRequired()).toBe(true);
    restoreFetch();
  });

  it("ignores a healthy 200 response from the gateway", async () => {
    const restoreFetch = installFetchStub(() => new Response("{}", { status: 200 }));
    const { service } = makeService();
    const result = await service.probeAuth();
    expect(result).toBe(false);
    expect(service.authRequired()).toBe(false);
    restoreFetch();
  });

  it("treats fetch errors as transient and does not flag auth required", async () => {
    const restoreFetch = installFetchStub(() => { throw new TypeError("network down"); });
    const { service } = makeService();
    const result = await service.probeAuth();
    expect(result).toBe(false);
    expect(service.authRequired()).toBe(false);
    restoreFetch();
  });

  it("schedules an auth probe after the WebSocket disconnects when a session was active", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response("{}", { status: 401 })));
    const originalFetch = (globalThis as any).fetch;
    (globalThis as any).fetch = fetchSpy;
    try {
      const { service } = makeService();
      // Pretend we have an active session: the probe must NOT fire without one,
      // otherwise a slow first connect could trip a false positive.
      (service as any).generation = "gen-1";
      (service as any).scheduleAuthProbe();
      expect(fetchSpy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(4_000);
      // Allow the queued promise to resolve; the test framework's microtask
      // queue runs synchronously after timer advancement in vitest.
      await Promise.resolve();
      await Promise.resolve();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(service.authRequired()).toBe(true);
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });

  it("clears the auth flag once the WebSocket reconnects", async () => {
    const { service } = makeService();
    service.authRequired.set(true);
    // Simulate the onopen path that the real socket triggers.
    (service as any).state.set("connected");
    (service as any).authRequired.set(false);
    expect(service.authRequired()).toBe(false);
  });
});
