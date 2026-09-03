import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_PRESET_BYTES = 64 * 1024;

export interface ModelPreset {
  model: string;
  modelProvider: string;
}

function tomlString(document: string, key: "model" | "model_provider"): string | undefined {
  const assignment = new RegExp(`^\\s*${key}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|'[^']*')\\s*(?:#.*)?$`);
  for (const line of document.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) break;
    const match = line.match(assignment);
    if (!match) continue;
    try {
      const value = match[1].startsWith('"') ? JSON.parse(match[1]) : match[1].slice(1, -1);
      const normalized = typeof value === "string" ? value.trim() : "";
      return normalized && normalized.length <= 256 ? normalized : undefined;
    } catch { return undefined; }
  }
  return undefined;
}

export async function discoverModelPresets(codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex")): Promise<ModelPreset[]> {
  let entries;
  try { entries = await readdir(codexHome, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }

  const presets = new Map<string, ModelPreset>();
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".config.toml")) continue;
    const path = join(codexHome, entry.name);
    if ((await stat(path)).size > MAX_PRESET_BYTES) continue;
    const document = await readFile(path, "utf8");
    const model = tomlString(document, "model");
    const modelProvider = tomlString(document, "model_provider");
    if (!model || !modelProvider) continue;
    presets.set(`${modelProvider}\u0000${model}`, { model, modelProvider });
  }
  return [...presets.values()];
}
