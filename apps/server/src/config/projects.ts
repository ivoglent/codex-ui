import { realpath } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { ProjectConfig } from "@codex-control/shared";

export class ProjectRegistry {
  private constructor(readonly projects: readonly ProjectConfig[]) {}

  static async load(path: string): Promise<ProjectRegistry> {
    const parsed = parse(readFileSync(path, "utf8")) as { projects?: ProjectConfig[] };
    const projects = parsed.projects ?? [];
    const ids = new Set<string>(); const roots = new Set<string>(); const resolved: ProjectConfig[] = [];
    for (const project of projects) {
      if (!/^[a-z0-9][a-z0-9-]*$/i.test(project.id) || ids.has(project.id)) throw new Error(`Invalid or duplicate project id: ${project.id}`);
      const root = await realpath(project.root);
      if (roots.has(root)) throw new Error(`Duplicate project root: ${root}`);
      ids.add(project.id); roots.add(root); resolved.push({ ...project, root });
    }
    for (let i = 0; i < resolved.length; i++) for (let j = i + 1; j < resolved.length; j++) {
      if (resolved[i].root.startsWith(`${resolved[j].root}/`) || resolved[j].root.startsWith(`${resolved[i].root}/`)) throw new Error(`Overlapping project roots: ${resolved[i].id}, ${resolved[j].id}`);
    }
    return new ProjectRegistry(resolved);
  }

  get(id: string): ProjectConfig | undefined { return this.projects.find((project) => project.id === id); }
  projectForPath(path: string): ProjectConfig | undefined { return this.projects.find((project) => path === project.root || path.startsWith(`${project.root}/`)); }
}
