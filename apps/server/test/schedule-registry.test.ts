import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ScheduleRegistry, ScheduleValidationError } from "../src/config/schedules.js";

const containers: string[] = [];
afterEach(() => { for (const dir of containers.splice(0)) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } } });

async function makeRegistry(injectedNow: () => Date = () => new Date()): Promise<{ registry: ScheduleRegistry; root: string; persistence: string }> {
  const container = mkdtempSync(join(tmpdir(), "schedule-reg-"));
  containers.push(container);
  const root = join(container, "workspaces");
  mkdirSync(root);
  const project = join(root, "alpha");
  mkdirSync(project);
  const persistence = join(container, "state", "schedules.json");
  const registry = await ScheduleRegistry.load({ safeRoot: root, persistencePath: persistence, now: injectedNow });
  return { registry, root, persistence };
}

function nearFutureCron(): string {
  const next = new Date(Date.now() + 60_000);
  return `${next.getMinutes()} ${next.getHours()} * * *`;
}

describe("ScheduleRegistry", () => {
  it("creates and persists schedules with a normalised cwd and computed nextRunAt", async () => {
    const { registry, persistence } = await makeRegistry();
    const record = await registry.create({
      cwd: join((registry as any).safeRoot, "alpha"),
      prompt: "Summarise today",
      cron: nearFutureCron()
    });
    expect(record.status).toBe("pending");
    expect(record.cwd).toBe(registry.safeRootPath + "/alpha");
    expect(record.nextRunAt).toBeTruthy();
    const persisted = JSON.parse((await import("node:fs")).readFileSync(persistence, "utf8"));
    expect(persisted.version).toBe(1);
    expect(persisted.schedules[0].id).toBe(record.id);
    expect(persisted.schedules[0].cron).toBe(record.cron);
  });

  it("rejects cwds outside the safe root", async () => {
    const { registry } = await makeRegistry();
    await expect(registry.create({ cwd: "/tmp", prompt: "x", cron: "*/5 * * * *" })).rejects.toMatchObject({ code: "INVALID_CWD" });
  });

  it("rejects relative cwds", async () => {
    const { registry } = await makeRegistry();
    await expect(registry.create({ cwd: "alpha", prompt: "x", cron: "*/5 * * * *" })).rejects.toMatchObject({ code: "INVALID_CWD" });
  });

  it("rejects invalid cron expressions", async () => {
    const { registry } = await makeRegistry();
    await expect(registry.create({ cwd: registry.safeRootPath + "/alpha", prompt: "x", cron: "every minute" })).rejects.toMatchObject({ code: "CRON_FIELD_COUNT" });
  });

  it("requires modelKey and modelProvider together", async () => {
    const { registry } = await makeRegistry();
    await expect(registry.create({ cwd: registry.safeRootPath + "/alpha", prompt: "x", modelKey: "gpt-5", cron: "*/5 * * * *" })).rejects.toMatchObject({ code: "MODEL_REQUIRED" });
  });

  it("updates only pending schedules", async () => {
    const { registry } = await makeRegistry();
    const record = await registry.create({ cwd: registry.safeRootPath + "/alpha", prompt: "x", cron: "*/5 * * * *" });
    await registry.replace({ ...record, status: "running" });
    await expect(registry.update(record.id, { prompt: "y" })).rejects.toBeInstanceOf(ScheduleValidationError);
  });

  it("dueBy picks only pending schedules whose nextRunAt has passed", async () => {
    const container = mkdtempSync(join(tmpdir(), "due-by-"));
    containers.push(container);
    const root = join(container, "workspaces");
    mkdirSync(root);
    mkdirSync(join(root, "alpha"));
    const now = { value: new Date(1_500) };
    const registry = await ScheduleRegistry.load({ safeRoot: root, persistencePath: join(container, "schedules.json"), now: () => now.value });
    const due = await registry.create({ cwd: registry.safeRootPath + "/alpha", prompt: "due", cron: "* * * * *" });
    await registry.create({ cwd: registry.safeRootPath + "/alpha", prompt: "future", cron: "0 0 1 1 *" });
    now.value = new Date(120_000);
    const picked = registry.dueBy(now.value);
    expect(picked.map((schedule) => schedule.id)).toEqual([due.id]);
  });
});
