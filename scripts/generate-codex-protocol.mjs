import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const generated = new URL("../packages/codex-protocol/generated", import.meta.url);
const schema = new URL("../packages/codex-protocol/schema", import.meta.url);
rmSync(generated, { recursive: true, force: true });
rmSync(schema, { recursive: true, force: true });
mkdirSync(generated, { recursive: true }); mkdirSync(schema, { recursive: true });
execFileSync("codex", ["app-server", "generate-ts", "--experimental", "--out", generated.pathname], { stdio: "inherit" });
execFileSync("codex", ["app-server", "generate-json-schema", "--experimental", "--out", schema.pathname], { stdio: "inherit" });
const codexVersion = execFileSync("codex", ["--version"], { encoding: "utf8" }).trim();
writeFileSync(new URL("../packages/codex-protocol/protocol-version.json", import.meta.url), `${JSON.stringify({ codexVersion, generatedAt: new Date().toISOString(), experimental: true }, null, 2)}\n`);
