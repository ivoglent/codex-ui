import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { generatedProtocolVersion as protocolMetadata } from "@codex-control/codex-protocol/version";

const execFileAsync = promisify(execFile);
export async function readVersionStatus(executable = process.env.CODEX_EXECUTABLE ?? "codex") {
  try {
    const { stdout } = await execFileAsync(executable, ["--version"]);
    const installed = stdout.trim();
    return { application: "0.1.0", node: process.version, codex: installed, generatedProtocol: protocolMetadata.codexVersion, compatible: installed === protocolMetadata.codexVersion };
  } catch {
    return { application: "0.1.0", node: process.version, codex: null, generatedProtocol: protocolMetadata.codexVersion, compatible: false, error: "Codex version unavailable" };
  }
}
