import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduleRegistry } from "../src/config/schedules.js";
import { Scheduler } from "../src/scheduler/scheduler.js";

const containers: string[] = [];
const schedulers: Scheduler[] = [];
afterEach(async () => {
  for (const scheduler of schedulers.splice(0)) await scheduler.stop();
  for (const dir of containers.splice(0)) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
});

interface FakeBroker { request: ReturnType<typeof vi.fn> }

function makeSupervisor(): any {
  const broker: FakeBroker = { request: vi.fn() };
  const supervisor = new EventEmitter();
  (supervisor as any).status = { state: "READY" };
  (supervisor as any).broker = broker;
  return supervisor;
}

async function makeRegistry(injectedNow: () => Date): Promise<ScheduleRegistry> {
  const container = mkdtempSync(join(tmpdir(), "scheduler-"));
  containers.push(container);
  const root = join(container, "workspaces");
  mkdirSync(root);
  mkdirSync(join(root, "alpha"));
  return ScheduleRegistry.load({ safeRoot: root, persistencePath: join(container, "schedules.json"), now: injectedNow });
}

async function flushMicrotasks(): Promise<void> { for (let i = 0; i < 10; i++) await Promise.resolve(); }

describe("Scheduler with cron", () => {
  it("runs due schedules through the broker and advances nextRunAt after success", async () => {
    const now = { value: new Date(2_000_000) };
    const advance = (ms: number) => { now.value = new Date(now.value.getTime() + ms); };
    const registry = await makeRegistry(() => now.value);
    const supervisor = makeSupervisor();
    supervisor.broker.request.mockResolvedValueOnce({ thread: { id: "thread-1" } }).mockResolvedValueOnce({ turn: { id: "turn-1" } });
    const broadcasts: any[] = [];
    const scheduler = new Scheduler({ registry, supervisor, broadcast: (schedule) => broadcasts.push(schedule), tickMs: 10, now: () => now.value });
    schedulers.push(scheduler);
    scheduler.start();
    await registry.create({ cwd: registry.safeRootPath + "/alpha", prompt: "Hi", cron: "* * * * *" });
    advance(60_000);
    await scheduler.tick();
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await scheduler.stop();
    expect(supervisor.broker.request).toHaveBeenCalledWith("thread/start", { cwd: registry.safeRootPath + "/alpha" });
    expect(supervisor.broker.request).toHaveBeenCalledWith("turn/start", { threadId: "thread-1", input: [{ type: "text", text: "Hi" }] });
    const final = registry.list()[0];
    expect(final.status).toBe("pending");
    expect(final.nextRunAt).toBeTruthy();
    expect(final.lastThreadId).toBe("thread-1");
    expect(final.lastTurnId).toBe("turn-1");
  });

  it("does not run anything when the app-server is not ready", async () => {
    const now = { value: new Date(2_000_000) };
    const registry = await makeRegistry(() => now.value);
    const supervisor = makeSupervisor();
    (supervisor as any).status = { state: "INITIALIZING" };
    const scheduler = new Scheduler({ registry, supervisor, broadcast: () => undefined, tickMs: 10, now: () => now.value });
    schedulers.push(scheduler);
    scheduler.start();
    await registry.create({ cwd: registry.safeRootPath + "/alpha", prompt: "Hi", cron: "* * * * *" });
    await scheduler.tick();
    await flushMicrotasks();
    expect(supervisor.broker.request).not.toHaveBeenCalled();
    await scheduler.stop();
  });

  it("does not duplicate inflight runs on the same cwd", async () => {
    const now = { value: new Date(2_000_000) };
    const advance = (ms: number) => { now.value = new Date(now.value.getTime() + ms); };
    const registry = await makeRegistry(() => now.value);
    const supervisor = makeSupervisor();
    let rejectTurn: ((error: Error) => void) | undefined;
    let resolveThreadStart: (() => void) | undefined;
    const threadStartCalled = new Promise<void>((resolve) => { resolveThreadStart = resolve; });
    supervisor.broker.request.mockImplementation(((method: string) => {
      if (method === "thread/start") {
        queueMicrotask(() => resolveThreadStart?.());
        return Promise.resolve({ thread: { id: "thread-1" } });
      }
      if (method === "turn/start") return new Promise((_, reject) => { rejectTurn = reject; });
      return Promise.resolve({});
  }) as any);
    const scheduler = new Scheduler({ registry, supervisor, broadcast: () => undefined, tickMs: 10, now: () => now.value });
    schedulers.push(scheduler);
    scheduler.start();
    await registry.create({ cwd: registry.safeRootPath + "/alpha", prompt: "Hi", cron: "* * * * *" });
    advance(60_000);
    await scheduler.tick();
    await threadStartCalled;
    await scheduler.tick();
    await flushMicrotasks();
    const startCalls = (supervisor.broker.request.mock.calls as any[]).filter(([method]) => method === "thread/start").length;
    expect(startCalls).toBe(1);
    rejectTurn?.(new Error("cancelled"));
    await flushMicrotasks();
    await scheduler.stop();
  });
});
