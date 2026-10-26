import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectRegistry } from "../src/config/projects.js";

describe("ProjectRegistry", () => {
  it("resolves configured roots and rejects duplicates", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-"));
    const config = join(root, "projects.yaml");
    const persistencePath = join(root, "state", "projects.json");
    writeFileSync(config, `projects:\n  - id: one\n    name: One\n    root: ${root}\n`);
    expect((await ProjectRegistry.load(config, { persistencePath })).get("one")?.root).toBe(root);
    writeFileSync(config, `projects:\n  - { id: one, name: One, root: ${root} }\n  - { id: one, name: Two, root: ${root} }\n`);
    await expect(ProjectRegistry.load(config, { persistencePath })).rejects.toThrow();
  });

  it("discovers repositories within bounded roots", async () => {
    const root = mkdtempSync(join(tmpdir(), "discovery-"));
    const direct = join(root, "codex-ui");
    const nested = join(root, "ai", "memory-service");
    mkdirSync(join(direct, ".git"), { recursive: true });
    mkdirSync(join(nested, ".git"), { recursive: true });
    mkdirSync(join(root, "ignored", "too", "deep", ".git"), { recursive: true });
    const config = join(root, "projects.yaml");
    writeFileSync(config, `discovery:\n  roots: ["\${TEST_PROJECTS_ROOT}"]\n  depth: 2\n`);
    process.env.TEST_PROJECTS_ROOT = root;

    const registry = await ProjectRegistry.load(config, { persistencePath: join(root, "state", "projects.json") });

    expect(registry.projects.map((project) => project.id)).toEqual(["ai-memory-service", "codex-ui"]);
    expect(registry.projects.every((project) => project.discovered)).toBe(true);
    expect(registry.get("codex-ui")!.root).toBe(direct);
  });

  it("adds a repository discovered after startup without changing existing projects", async () => {
    const root = mkdtempSync(join(tmpdir(), "refresh-discovery-"));
    const config = join(root, "projects.yaml");
    writeFileSync(config, `discovery:\n  roots: [${root}]\n  depth: 1\n`);
    const registry = await ProjectRegistry.load(config, { persistencePath: join(root, "state", "projects.json") });
    mkdirSync(join(root, "new-project", ".git"), { recursive: true });
    await expect(registry.refreshDiscovered()).resolves.toBe(true);
    expect(registry.get("new-project")).toMatchObject({ root: join(root, "new-project"), discovered: true });
    await expect(registry.refreshDiscovered()).resolves.toBe(false);
  });

  it("lets explicit projects override discovery by root", async () => {
    const root = mkdtempSync(join(tmpdir(), "override-"));
    const repository = join(root, "repo");
    mkdirSync(join(repository, ".git"), { recursive: true });
    const config = join(root, "projects.yaml");
    writeFileSync(config, `discovery:\n  roots: [${root}]\nprojects:\n  - id: custom\n    name: Custom Name\n    root: ${repository}\n`);
    const registry = await ProjectRegistry.load(config, { persistencePath: join(root, "state", "projects.json") });
    expect(registry.projects).toHaveLength(1);
    expect(registry.get("custom")?.name).toBe("Custom Name");
  });

  it("creates and reloads a safe persisted project with current defaults", async () => {
    const container = mkdtempSync(join(tmpdir(), "create-project-"));
    const root = join(container, "workspaces");
    const config = join(container, "projects.yaml");
    const persistencePath = join(container, "codex-home", "codex-ui", "projects.json");
    mkdirSync(root);
    writeFileSync(config, `discovery:\n  roots: [${root}]\n  depth: 0\n  defaults: { approvalPolicy: never, model: first-model }\n`);
    const registry = await ProjectRegistry.load(config, { persistencePath });
    const project = await registry.create("  Trading   Wörker  ");
    expect(project).toMatchObject({ id: "trading-worker", name: "Trading Wörker", root: join(root, "trading-worker"), defaults: { approvalPolicy: "never", model: "first-model" } });
    expect(existsSync(project.root)).toBe(true);
    expect(JSON.parse(readFileSync(persistencePath, "utf8"))).toEqual({ version: 1, projects: [{ id: "trading-worker", name: "Trading Wörker", root: join(root, "trading-worker") }] });
    writeFileSync(config, `discovery:\n  roots: [${root}]\n  depth: 0\n  defaults: { approvalPolicy: on-request, model: current-model }\n`);
    const reloaded = await ProjectRegistry.load(config, { persistencePath });
    expect(reloaded.get("trading-worker")?.defaults).toEqual({ approvalPolicy: "on-request", model: "current-model" });
  });

  it("returns clear validation and collision errors", async () => {
    const container = mkdtempSync(join(tmpdir(), "project-errors-"));
    const root = join(container, "workspaces");
    const config = join(container, "projects.yaml");
    mkdirSync(root);
    writeFileSync(config, `discovery:\n  roots: [${root}]\n  depth: 0\n`);
    const registry = await ProjectRegistry.load(config, { persistencePath: join(container, "projects.json") });
    await expect(registry.create("💥")).rejects.toMatchObject({ status: 400, code: "INVALID_PROJECT_NAME" });
    const [first, second] = await Promise.allSettled([registry.create("Same project"), registry.create("Same project")]);
    expect(first.status).toBe("fulfilled");
    expect(second).toMatchObject({ status: "rejected", reason: { status: 409, code: "PROJECT_EXISTS" } });
  });

  it("rejects malformed persisted state instead of silently losing projects", async () => {
    const container = mkdtempSync(join(tmpdir(), "project-state-"));
    const root = join(container, "workspaces");
    const config = join(container, "projects.yaml");
    const persistencePath = join(container, "projects.json");
    mkdirSync(root);
    writeFileSync(config, `discovery:\n  roots: [${root}]\n  depth: 0\n`);
    writeFileSync(persistencePath, "not json");
    await expect(ProjectRegistry.load(config, { persistencePath })).rejects.toThrow("Invalid UI project registry JSON");
  });
});
