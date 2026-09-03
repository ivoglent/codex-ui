import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectRegistry } from "../src/config/projects.js";
import { handleProjectsApi } from "../src/http/projects-api.js";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });

async function fixture() {
  const container = mkdtempSync(join(tmpdir(), "projects-api-"));
  const root = join(container, "workspaces");
  mkdirSync(root);
  const config = join(container, "projects.yaml");
  writeFileSync(config, `discovery:\n  roots: [${root}]\n  depth: 0\n  codeServerBaseUrl: https://code.example/\n`);
  const registry = await ProjectRegistry.load(config, { persistencePath: join(container, "state", "projects.json") });
  let changed = 0;
  const server = createServer((request, response) => void handleProjectsApi(request, response, registry, "https://ui.example", () => changed++));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { registry, url: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/api/projects`, changed: () => changed };
}

describe("projects API", () => {
  it("creates a project and reports collisions", async () => {
    const { registry, url, changed } = await fixture();
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", origin: "https://ui.example" }, body: JSON.stringify({ name: "Mobile Project" }) });
    expect(response.status).toBe(201);
    expect((await response.json()).project.id).toBe("mobile-project");
    expect(registry.get("mobile-project")).toBeTruthy();
    expect(changed()).toBe(1);

    const collision = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Mobile Project" }) });
    expect(collision.status).toBe(409);
    expect((await collision.json()).error.code).toBe("PROJECT_EXISTS");
    expect(changed()).toBe(1);
  });

  it("enforces the narrow request contract", async () => {
    const { url } = await fixture();
    const wrongOrigin = await fetch(url, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ name: "Nope" }) });
    expect(wrongOrigin.status).toBe(403);
    const extraPath = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Nope", root: "/tmp/nope" }) });
    expect(extraPath.status).toBe(400);
    const wrongType = await fetch(url, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
    expect(wrongType.status).toBe(415);
  });
});
