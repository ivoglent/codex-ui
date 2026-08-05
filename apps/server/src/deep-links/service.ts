import { realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { ProjectConfig } from "@codex-control/shared";

export async function createDeepLink(project: ProjectConfig, requestedPath?: string, line?: number): Promise<string> {
  if (!requestedPath) return project.codeServerUrl;
  const candidate = await realpath(resolve(project.root, requestedPath));
  const rel = relative(project.root, candidate);
  if (rel.startsWith("..") || rel === "..") throw new Error("Path escapes configured project root");
  if (!project.fileUrlTemplate) return project.codeServerUrl;
  return project.fileUrlTemplate.replace("{path}", encodeURIComponent(candidate)).replace("{line}", String(line ?? 1));
}
