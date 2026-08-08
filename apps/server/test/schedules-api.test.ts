import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ScheduleRegistry } from "../src/config/schedules.js";
import { handleSchedulesApi } from "../src/http/schedules-api.js";

const servers: ReturnType<typeof createServer>[] = [];
const containers: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const dir of containers.splice(0)) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
});

async function fixture() {
  const container = mkdtempSync(join(tmpdir(), "schedules-api-"));
  containers.push(container);
  const root = join(container, "workspaces");
  mkdirSync(root);
  mkdirSync(join(root, "alpha"));
  const registry = await ScheduleRegistry.load({ safeRoot: root, persistencePath: join(container, "schedules.json") });
  const changes: any[] = [];
  const server = createServer((request, response) => void handleSchedulesApi(request, response, { registry, publicOrigin: "https://ui.example", onChanged: (schedule) => changes.push(schedule) }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/api/schedules`;
  return { registry, baseUrl, changes };
}

describe("schedules API", () => {
  it("creates a schedule and broadcasts the change", async () => {
    const { registry, baseUrl, changes } = await fixture();
    const response = await fetch(baseUrl, { method: "POST", headers: { "content-type": "application/json", origin: "https://ui.example" }, body: JSON.stringify({ cwd: registry.safeRootPath + "/alpha", prompt: "Hi", runAt: new Date(Date.now() + 60_000).toISOString() }) });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.schedule.prompt).toBe("Hi");
    expect(changes.length).toBe(1);
  });

  it("rejects unknown paths via origin and content-type guards", async () => {
    const { registry, baseUrl } = await fixture();
    const wrongOrigin = await fetch(baseUrl, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ cwd: registry.safeRootPath + "/alpha", prompt: "Hi", runAt: new Date(Date.now() + 60_000).toISOString() }) });
    expect(wrongOrigin.status).toBe(403);
    const wrongType = await fetch(baseUrl, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
    expect(wrongType.status).toBe(415);
  });

  it("runs and cancels a schedule", async () => {
    const { registry, baseUrl } = await fixture();
    const created = await (await fetch(baseUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: registry.safeRootPath + "/alpha", prompt: "Hi", runAt: new Date(Date.now() + 60_000).toISOString() }) })).json();
    const run = await fetch(`${baseUrl}/${created.schedule.id}/run`, { method: "POST" });
    expect(run.status).toBe(202);
    const runBody = await run.json();
    expect(new Date(runBody.schedule.runAt).getTime()).toBeLessThanOrEqual(Date.now());
    const cancel = await fetch(`${baseUrl}/${created.schedule.id}/cancel`, { method: "POST" });
    expect(cancel.status).toBe(200);
    expect((await cancel.json()).schedule.status).toBe("cancelled");
  });
});
