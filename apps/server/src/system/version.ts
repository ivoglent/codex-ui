import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { generatedProtocolVersion as protocolMetadata } from "@codex-control/codex-protocol/version";

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(here, "..", "..", "package.json");
const fallbackVersion = (() => {
  try {
    const raw = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
    return typeof raw.version === "string" ? raw.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

export interface VersionStatus {
  application: string;
  commit: string | null;
  node: string;
  codex: string | null;
  generatedProtocol: string;
  compatible: boolean;
  error?: string;
}

/**
 * Report the running application version. The release workflow passes the
 * semantic version and commit SHA at build time so the deployed UI can show
 * users which build they are running and whether a newer one is available.
 * Local development builds fall back to the workspace package version.
 */
export async function readVersionStatus(executable = process.env.CODEX_EXECUTABLE ?? "codex"): Promise<VersionStatus> {
  const application = process.env.APP_VERSION?.trim() || fallbackVersion;
  const commit = process.env.APP_COMMIT?.trim() || null;
  try {
    const { stdout } = await execFileAsync(executable, ["--version"]);
    const installed = stdout.trim();
    return { application, commit, node: process.version, codex: installed, generatedProtocol: protocolMetadata.codexVersion, compatible: installed === protocolMetadata.codexVersion };
  } catch {
    return { application, commit, node: process.version, codex: null, generatedProtocol: protocolMetadata.codexVersion, compatible: false, error: "Codex version unavailable" };
  }
}
