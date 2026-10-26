import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, open, readFile, realpath, readdir, rename, rmdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { parse } from "yaml";
import type { ProjectConfig } from "@codex-control/shared";

interface DiscoveryConfig {
  roots: string[];
  depth?: number;
  markers?: string[];
  defaults?: Record<string, unknown>;
}

interface ProjectsFile {
  discovery?: DiscoveryConfig;
  projects?: ProjectConfig[];
}

interface PersistedProject {
  id: string;
  name: string;
  root: string;
}

interface PersistedProjectsFile {
  version: 1;
  projects: PersistedProject[];
}

export interface ProjectRegistryOptions {
  persistencePath?: string;
}

interface DiscoveryRuntimeConfig {
  scanRoots: readonly string[];
  depth: number;
  markers: readonly string[];
  defaults?: Record<string, unknown>;
}

export class ProjectCreateError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "ProjectCreateError";
  }
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

export const projectSlug = (name: string): string => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

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

function validateDisplayName(value: unknown): string {
  if (typeof value !== "string") throw new ProjectCreateError(400, "INVALID_PROJECT_NAME", "Project name is required");
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) throw new ProjectCreateError(400, "INVALID_PROJECT_NAME", "Project name is required");
  if (name.length > 80) throw new ProjectCreateError(400, "INVALID_PROJECT_NAME", "Project name must be 80 characters or fewer");
  if (!projectSlug(name)) throw new ProjectCreateError(400, "INVALID_PROJECT_NAME", "Project name must contain a letter or number that can form a safe directory name");
  return name;
}

function defaultPersistencePath(): string {
  const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  return process.env.CODEX_UI_PROJECTS_FILE ?? join(codexHome, "codex-ui", "projects.json");
}

async function loadPersistedProjects(path: string): Promise<PersistedProject[]> {
  let raw: string;
  try { raw = await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error(`Invalid UI project registry JSON: ${path}`); }
  const document = value as Partial<PersistedProjectsFile>;
  if (document.version !== 1 || !Array.isArray(document.projects)) throw new Error(`Unsupported UI project registry format: ${path}`);
  return document.projects.map((project) => {
    if (!project || typeof project.id !== "string" || typeof project.name !== "string" || typeof project.root !== "string") throw new Error(`Invalid UI project record: ${path}`);
    return { id: project.id, name: project.name, root: project.root };
  });
}

export class ProjectRegistry {
  private currentProjects: readonly ProjectConfig[];
  private mutation: Promise<void> = Promise.resolve();

  private constructor(
    projects: readonly ProjectConfig[],
    private readonly persisted: PersistedProject[],
    private readonly persistencePath: string,
    private readonly creationRoot?: string,
    private readonly creationDefaults?: Record<string, unknown>,
    private readonly discovery?: DiscoveryRuntimeConfig
  ) { this.currentProjects = Object.freeze([...projects]); }

  get projects(): readonly ProjectConfig[] { return this.currentProjects; }

  static async load(path: string, options: ProjectRegistryOptions = {}): Promise<ProjectRegistry> {
    const parsed = parse(readFileSync(path, "utf8")) as ProjectsFile;
    const projects: ProjectConfig[] = [];
    const ids = new Set<string>();
    const roots = new Set<string>();
    const persistencePath = options.persistencePath ?? defaultPersistencePath();
    let creationRoot: string | undefined;
    let creationDefaults: Record<string, unknown> | undefined;

    const add = async (project: ProjectConfig): Promise<void> => {
      const root = await realpath(expandEnvironment(project.root));
      if (!/^[a-z0-9][a-z0-9-]*$/i.test(project.id) || ids.has(project.id)) throw new Error(`Invalid or duplicate project id: ${project.id}`);
      if (roots.has(root)) throw new Error(`Duplicate project root: ${root}`);
      ids.add(project.id);
      roots.add(root);
      projects.push({ ...project, root });
    };

    for (const project of parsed.projects ?? []) await add(project);

    if (parsed.discovery) {
      const depth = parsed.discovery.depth ?? 2;
      if (!Number.isInteger(depth) || depth < 0 || depth > 8) throw new Error("Discovery depth must be an integer between 0 and 8");
      const markers = parsed.discovery.markers ?? [".git"];
      if (markers.length === 0 || markers.some((marker) => !marker || marker.includes("/") || marker.includes("\\"))) throw new Error("Discovery markers must be file names");
      const scanRoots = await Promise.all(parsed.discovery.roots.map((root) => realpath(expandEnvironment(root))));
      if (scanRoots.length > 1) throw new Error("Project creation requires exactly one discovery root");
      creationRoot = scanRoots[0];
      creationDefaults = parsed.discovery.defaults;

      for (const scanRoot of scanRoots) {
        for (const root of await discoverRepositories(scanRoot, depth, markers)) {
          if (roots.has(root)) continue;
          let id = projectId(scanRoot, root);
          if (ids.has(id)) id = `${id}-${createHash("sha256").update(root).digest("hex").slice(0, 8)}`;
          await add({ id, name: basename(root), root, defaults: parsed.discovery.defaults, discovered: true });
        }
      }
    }

    const persisted = await loadPersistedProjects(persistencePath);
    if (persisted.length && !creationRoot) throw new Error("UI-created projects require one configured discovery root");
    for (const project of persisted) {
      const storedRoot = resolve(project.root);
      if (projectSlug(project.name) !== project.id || dirname(storedRoot) !== creationRoot || basename(storedRoot) !== project.id) throw new Error(`Persisted project is outside the configured projects root or has invalid identity: ${project.id}`);
      await add({ ...project, root: storedRoot, defaults: creationDefaults, discovered: true });
    }

    validateOverlaps(projects);
    const discovery = parsed.discovery ? {
      scanRoots: await Promise.all(parsed.discovery.roots.map((root) => realpath(expandEnvironment(root)))),
      depth: parsed.discovery.depth ?? 2,
      markers: parsed.discovery.markers ?? [".git"],
      defaults: parsed.discovery.defaults
    } : undefined;
    return new ProjectRegistry(projects, persisted, persistencePath, creationRoot, creationDefaults, discovery);
  }

  get(id: string): ProjectConfig | undefined { return this.currentProjects.find((project) => project.id === id); }
  projectForPath(path: string): ProjectConfig | undefined { return this.currentProjects.find((project) => path === project.root || path.startsWith(`${project.root}${sep}`)); }

  /** Adds repositories that appeared under configured discovery roots after startup. */
  refreshDiscovered(): Promise<boolean> {
    const task = this.mutation.then(() => this.refreshDiscoveredExclusive());
    this.mutation = task.then(() => undefined, () => undefined);
    return task;
  }

  create(nameValue: unknown): Promise<ProjectConfig> {
    const task = this.mutation.then(() => this.createExclusive(nameValue));
    this.mutation = task.then(() => undefined, () => undefined);
    return task;
  }

  private async createExclusive(nameValue: unknown): Promise<ProjectConfig> {
    if (!this.creationRoot) throw new ProjectCreateError(503, "PROJECT_CREATION_UNAVAILABLE", "Project creation requires one configured projects root");
    const name = validateDisplayName(nameValue);
    const id = projectSlug(name);
    const root = join(this.creationRoot, id);
    if (dirname(root) !== this.creationRoot || basename(root) !== id) throw new ProjectCreateError(400, "INVALID_PROJECT_NAME", "Project name does not produce a safe directory");
    if (this.get(id) || this.currentProjects.some((project) => project.root === root)) throw new ProjectCreateError(409, "PROJECT_EXISTS", `Project '${id}' already exists`);

    try { await mkdir(root); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ProjectCreateError(409, "PROJECT_EXISTS", `Project directory '${id}' already exists`);
      throw new ProjectCreateError(503, "PROJECT_ROOT_UNAVAILABLE", `Could not create project directory '${id}'`);
    }

    const record = { id, name, root };
    const nextPersisted = [...this.persisted, record];
    try { await this.persist(nextPersisted); }
    catch (error) {
      try { await rmdir(root); } catch { /* Keep a non-empty directory rather than deleting user data. */ }
      if (error instanceof ProjectCreateError) throw error;
      throw new ProjectCreateError(503, "PROJECT_REGISTRY_UNAVAILABLE", "Project directory was not registered because the project registry could not be saved");
    }

    const project: ProjectConfig = { ...record, defaults: this.creationDefaults, discovered: true };
    this.persisted.push(record);
    this.currentProjects = Object.freeze([...this.currentProjects, project]);
    return project;
  }

  private async refreshDiscoveredExclusive(): Promise<boolean> {
    if (!this.discovery) return false;
    const existingRoots = new Set(this.currentProjects.map((project) => project.root));
    const ids = new Set(this.currentProjects.map((project) => project.id));
    const added: ProjectConfig[] = [];

    for (const scanRoot of this.discovery.scanRoots) {
      for (const root of await discoverRepositories(scanRoot, this.discovery.depth, this.discovery.markers)) {
        if (existingRoots.has(root)) continue;
        let id = projectId(scanRoot, root);
        if (ids.has(id)) id = `${id}-${createHash("sha256").update(root).digest("hex").slice(0, 8)}`;
        ids.add(id);
        existingRoots.add(root);
        added.push({ id, name: basename(root), root, defaults: this.discovery.defaults, discovered: true });
      }
    }

    if (!added.length) return false;
    this.currentProjects = Object.freeze([...this.currentProjects, ...added]);
    return true;
  }

  private async persist(projects: PersistedProject[]): Promise<void> {
    const directory = dirname(this.persistencePath);
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `.projects-${process.pid}-${randomUUID()}.tmp`);
    const file = await open(temporary, "wx", 0o600);
    let closed = false;
    try {
      await file.writeFile(`${JSON.stringify({ version: 1, projects }, null, 2)}\n`, "utf8");
      await file.sync();
      await file.close(); closed = true;
      await rename(temporary, this.persistencePath);
    } catch (error) {
      if (!closed) try { await file.close(); } catch { /* Best effort handle cleanup. */ }
      try { await unlink(temporary); } catch { /* Best effort temp cleanup. */ }
      throw error;
    }
  }
}

function validateOverlaps(projects: readonly ProjectConfig[]): void {
  for (let i = 0; i < projects.length; i++) for (let j = i + 1; j < projects.length; j++) {
    if (projects[i].root.startsWith(`${projects[j].root}${sep}`) || projects[j].root.startsWith(`${projects[i].root}${sep}`)) {
      throw new Error(`Overlapping project roots: ${projects[i].id}, ${projects[j].id}`);
    }
  }
}
