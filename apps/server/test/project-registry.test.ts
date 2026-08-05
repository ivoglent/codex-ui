import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectRegistry } from "../src/config/projects.js";

describe("ProjectRegistry", () => {
  it("resolves configured roots and rejects duplicates", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-"));
    const config = join(root, "projects.yaml");
    writeFileSync(config, `projects:\n  - id: one\n    name: One\n    root: ${root}\n    codeServerUrl: https://code/\n`);
    expect((await ProjectRegistry.load(config)).get("one")?.root).toBe(root);
    writeFileSync(config, `projects:\n  - { id: one, name: One, root: ${root}, codeServerUrl: https://code/ }\n  - { id: one, name: Two, root: ${root}, codeServerUrl: https://code/ }\n`);
    await expect(ProjectRegistry.load(config)).rejects.toThrow();
  });

  it("discovers repositories within bounded roots and generates code-server URLs", async () => {
    const root = mkdtempSync(join(tmpdir(), "discovery-"));
    const direct = join(root, "codex-ui");
    const nested = join(root, "ai", "memory-service");
    mkdirSync(join(direct, ".git"), { recursive: true });
    mkdirSync(join(nested, ".git"), { recursive: true });
    mkdirSync(join(root, "ignored", "too", "deep", ".git"), { recursive: true });
    const config = join(root, "projects.yaml");
    writeFileSync(config, `discovery:\n  roots: [\"\${TEST_PROJECTS_ROOT}\"]\n  depth: 2\n  codeServerBaseUrl: \"\${TEST_CODE_SERVER_URL}\"\n`);
    process.env.TEST_PROJECTS_ROOT = root;
    process.env.TEST_CODE_SERVER_URL = "https://code.example.internal/";

    const registry = await ProjectRegistry.load(config);

    expect(registry.projects.map((project) => project.id)).toEqual(["ai-memory-service", "codex-ui"]);
    expect(registry.projects.every((project) => project.discovered)).toBe(true);
    expect(new URL(registry.get("codex-ui")!.codeServerUrl).searchParams.get("folder")).toBe(direct);
  });

  it("lets explicit projects override discovery by root", async () => {
    const root = mkdtempSync(join(tmpdir(), "override-"));
    const repository = join(root, "repo");
    mkdirSync(join(repository, ".git"), { recursive: true });
    const config = join(root, "projects.yaml");
    writeFileSync(config, `discovery:\n  roots: [${root}]\n  codeServerBaseUrl: https://code/\nprojects:\n  - id: custom\n    name: Custom Name\n    root: ${repository}\n    codeServerUrl: https://override/\n`);

    const registry = await ProjectRegistry.load(config);

    expect(registry.projects).toHaveLength(1);
    expect(registry.get("custom")?.name).toBe("Custom Name");
  });
});
