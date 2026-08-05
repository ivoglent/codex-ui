import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import { basename, relative, sep } from "node:path";
import { parse } from "yaml";
import type { ProjectConfig } from "@codex-control/shared";

interface DiscoveryConfig {
  roots: string[];
  depth?: number;
  markers?: string[];
  codeServerBaseUrl: string;
  defaults?: Record<string, unknown>;
}

interface ProjectsFile {
  discovery?: DiscoveryConfig;
  projects?: ProjectConfig[];
}

const expandEnvironment = (value: string): string => value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, name: string) => {
  const replacement = process.env[name];
  if (!replacement) throw new Error(`Missing environment variable: ${name}`);
  return replacement;
});

const projectId = (scanRoot: string, projectRoot: string): string => {
  const source = relative(scanRoot, projectRoot) || basename(projectRoot);
  const id = source.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return id || `project-${createHash("sha256").update(projectRoot).digest("hex").slice(0, 8)}`;
};

const codeServerUrl = (baseUrl: string, root: string): string => {
  const url = new URL(baseUrl);
  url.searchParams.set("folder", root);
  return url.toString();
};

async function containsMarker(directory: string, markers: readonly string[]): Promise<boolean> {
  return markers.some((marker) => existsSync(`${directory}${sep}${marker}`));
}

async function discoverRepositories(directory: string, depth: number, markers: readonly string[]): Promise<string[]> {
  if (await containsMarker(directory, markers)) return [directory];
  if (depth === 0) return [];
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith("."))
    .sort((left, right) => left.name.localeCompare(right.name));
  const nested = await Promise.all(entries.map((entry) => discoverRepositories(`${directory}${sep}${entry.name}`, depth - 1, markers)));
  return nested.flat();
}

export class ProjectRegistry {
  private constructor(readonly projects: readonly ProjectConfig[]) {}

  static async load(path: string): Promise<ProjectRegistry> {
    const parsed = parse(readFileSync(path, "utf8")) as ProjectsFile;
    const projects: ProjectConfig[] = [];
    const ids = new Set<string>();
    const roots = new Set<string>();

    const add = async (project: ProjectConfig): Promise<void> => {
      const root = await realpath(expandEnvironment(project.root));
      if (!/^[a-z0-9][a-z0-9-]*$/i.test(project.id) || ids.has(project.id)) throw new Error(`Invalid or duplicate project id: ${project.id}`);
      if (roots.has(root)) throw new Error(`Duplicate project root: ${root}`);
      ids.add(project.id);
      roots.add(root);
      projects.push({ ...project, root, codeServerUrl: expandEnvironment(project.codeServerUrl) });
    };

    for (const project of parsed.projects ?? []) await add(project);

    if (parsed.discovery) {
      const depth = parsed.discovery.depth ?? 2;
      if (!Number.isInteger(depth) || depth < 0 || depth > 8) throw new Error("Discovery depth must be an integer between 0 and 8");
      const markers = parsed.discovery.markers ?? [".git"];
      if (markers.length === 0 || markers.some((marker) => !marker || marker.includes("/") || marker.includes("\\"))) throw new Error("Discovery markers must be file names");
      const baseUrl = expandEnvironment(parsed.discovery.codeServerBaseUrl);

      for (const configuredRoot of parsed.discovery.roots) {
        const scanRoot = await realpath(expandEnvironment(configuredRoot));
        for (const root of await discoverRepositories(scanRoot, depth, markers)) {
          if (roots.has(root)) continue;
          let id = projectId(scanRoot, root);
          if (ids.has(id)) id = `${id}-${createHash("sha256").update(root).digest("hex").slice(0, 8)}`;
          await add({
            id,
            name: basename(root),
            root,
            codeServerUrl: codeServerUrl(baseUrl, root),
            defaults: parsed.discovery.defaults,
            discovered: true
          });
        }
      }
    }

    for (let i = 0; i < projects.length; i++) for (let j = i + 1; j < projects.length; j++) {
      if (projects[i].root.startsWith(`${projects[j].root}${sep}`) || projects[j].root.startsWith(`${projects[i].root}${sep}`)) {
        throw new Error(`Overlapping project roots: ${projects[i].id}, ${projects[j].id}`);
      }
    }
    return new ProjectRegistry(projects);
  }

  get(id: string): ProjectConfig | undefined { return this.projects.find((project) => project.id === id); }
  projectForPath(path: string): ProjectConfig | undefined { return this.projects.find((project) => path === project.root || path.startsWith(`${project.root}${sep}`)); }
}
