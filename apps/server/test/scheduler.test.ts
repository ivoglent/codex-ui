import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduleRegistry } from "../src/config/schedules.js";
import { Scheduler } from "../src/scheduler/scheduler.js";

const containers: string[] = [];
afterEach(() => { for (const dir of containers.splice(0)) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } } });

interface FakeBroker { request: ReturnType<typeof vi.fn> }

function makeSupervisor(): any {
  const broker: FakeBroker = { request: vi.fn() };
  const supervisor = new EventEmitter();
  (supervisor as any).status = { state: "READY" };
  (supervisor as any).broker = broker;
  return supervisor;
}

async function makeRegistry(injectedNow: () => Date): Promise<{ registry: ScheduleRegistry; root: string }> {
  const container = mkdtempSync(join(tmpdir(), "scheduler-"));
  containers.push(container);
  const root = join(container, "workspaces");
  mkdirSync(root);
  mkdirSync(join(root, "alpha"));
  const registry = await ScheduleRegistry.load({ safeRoot: root, persistencePath: join(container, "schedules.json"), now: injectedNow });
  return { registry, root };
}

async function flushMicrotasks(): Promise<void> { for (let i = 0; i < 10; i++) await Promise.resolve(); }

describe("Scheduler", () => {
  it("runs due schedules through the broker and broadcasts each state", async () => {
    const now = { value: new Date(2_000_000) };
    const advance = (ms: number) => { now.value = new Date(now.value.getTime() + ms); };
    const { registry } = await makeRegistry(() => now.value);
    const supervisor = makeSupervisor();
    supervisor.broker.request.mockResolvedValueOnce({ thread: { id: "thread-1" } }).mockResolvedValueOnce({ turn: { id: "turn-1" } });
    const broadcasts: any[] = [];
    advance(-1_000);
    await registry.create({ cwd: registry.safeRootPath + "/alpha", prompt: "Hi", runAt: new Date(now.value.getTime() + 500).toISOString() });
    const scheduler = new Scheduler({ registry, supervisor, broadcast: (schedule) => broadcasts.push(schedule), tickMs: 10, now: () => now.value });
    scheduler.start();
    advance(2_000);
    await scheduler.tick();
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await scheduler.stop();
    expect(supervisor.broker.request).toHaveBeenCalledWith("thread/start", { cwd: registry.safeRootPath + "/alpha" });
    expect(supervisor.broker.request).toHaveBeenCalledWith("turn/start", { threadId: "thread-1", input: [{ type: "text", text: "Hi" }] });
    const statuses = broadcasts.map((record) => record.status);
    expect(statuses).toContain("running");
    expect(statuses).toContain("done");
    const final = broadcasts[broadcasts.length - 1];
    expect(final.status).toBe("done");
    expect(final.lastThreadId).toBe("thread-1");
    expect(final.lastTurnId).toBe("turn-1");
  });

  it("marks overdue schedules as failed", async () => {
    const now = { value: new Date(1_000) };
    const { registry } = await makeRegistry(() => now.value);
    const supervisor = makeSupervisor();
    const broadcasts: any[] = [];
    const scheduler = new Scheduler({ registry, supervisor, broadcast: (schedule) => broadcasts.push(schedule), tickMs: 10, now: () => now.value, missWindowMs: 1_000 });
    scheduler.start();
    await registry.create({ cwd: registry.safeRootPath + "/alpha", prompt: "Old", runAt: new Date(1_500).toISOString() });
    now.value = new Date(10_000_000);
    await scheduler.tick();
    await flushMicrotasks();
    await scheduler.stop();
    const final = registry.list()[0];
    expect(final.status).toBe("failed");
    expect(final.lastError).toBe("missed window");
  });

  it("does not run anything when the app-server is not ready", async () => {
    const now = { value: new Date(5_000) };
    const { registry } = await makeRegistry(() => now.value);
    const supervisor = makeSupervisor();
    (supervisor as any).status = { state: "INITIALIZING" };
    const scheduler = new Scheduler({ registry, supervisor, broadcast: () => undefined, tickMs: 10, now: () => now.value });
    scheduler.start();
    await registry.create({ cwd: registry.safeRootPath + "/alpha", prompt: "Hi", runAt: new Date(5_500).toISOString() });
    now.value = new Date(6_000);
    await scheduler.tick();
    await flushMicrotasks();
    expect(supervisor.broker.request).not.toHaveBeenCalled();
    await scheduler.stop();
  });
});
