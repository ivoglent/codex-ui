import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverModelPresets } from "../src/config/model-presets.js";

describe("model preset discovery", () => {
  it("returns atomic pairs from regular top-level preset files", async () => {
    const root = mkdtempSync(join(tmpdir(), "model-presets-"));
    writeFileSync(join(root, "minimax.config.toml"), `model = "MiniMax-M3"\nmodel_provider = "minimax"\nmodel_context_window = 1000000\n`);
    writeFileSync(join(root, "duplicate.config.toml"), `model_provider = 'minimax'\nmodel = 'MiniMax-M3'\n`);
    writeFileSync(join(root, "config.toml"), `model = "ignored"\nmodel_provider = "ignored"\n`);
    writeFileSync(join(root, "incomplete.config.toml"), `model = "missing-provider"\n`);
    mkdirSync(join(root, "nested.config.toml"));
    symlinkSync(join(root, "minimax.config.toml"), join(root, "linked.config.toml"));

    await expect(discoverModelPresets(root)).resolves.toEqual([{ model: "MiniMax-M3", modelProvider: "minimax" }]);
  });

  it("does not read pair fields from nested TOML sections", async () => {
    const root = mkdtempSync(join(tmpdir(), "model-presets-"));
    writeFileSync(join(root, "nested.config.toml"), `[profile]\nmodel = "not-top-level"\nmodel_provider = "minimax"\n`);
    await expect(discoverModelPresets(root)).resolves.toEqual([]);
  });

  it("treats a missing Codex home as an empty catalog", async () => {
    await expect(discoverModelPresets(join(tmpdir(), `missing-model-presets-${Date.now()}`))).resolves.toEqual([]);
  });
});
