import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const metadata = JSON.parse(readFileSync(new URL("../packages/codex-protocol/protocol-version.json", import.meta.url), "utf8"));
const installed = execFileSync("codex", ["--version"], { encoding: "utf8" }).trim();
if (installed !== metadata.codexVersion) { console.error(`Protocol mismatch: generated=${metadata.codexVersion}, installed=${installed}`); process.exitCode = 1; }
else console.log(`Protocol matches ${installed}`);
