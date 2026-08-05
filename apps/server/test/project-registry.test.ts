import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectRegistry } from "../src/config/projects.js";
describe("ProjectRegistry", () => {
  it("resolves configured roots and rejects duplicates", async () => { const root = mkdtempSync(join(tmpdir(), "projects-")); const config = join(root, "projects.yaml"); writeFileSync(config, `projects:\n  - id: one\n    name: One\n    root: ${root}\n    codeServerUrl: https://code/\n`); expect((await ProjectRegistry.load(config)).get("one")?.root).toBe(root); writeFileSync(config, `projects:\n  - { id: one, name: One, root: ${root}, codeServerUrl: https://code/ }\n  - { id: one, name: Two, root: ${root}, codeServerUrl: https://code/ }\n`); await expect(ProjectRegistry.load(config)).rejects.toThrow(); });
});
