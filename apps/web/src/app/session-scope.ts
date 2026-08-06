export const ALL_SESSIONS_ID = "__all__";

export interface SessionProject { id: string; name: string; root: string; [key: string]: unknown }
export interface SessionThread { cwd?: string | null; [key: string]: unknown }

const normalizedPath = (value: string): string => value.replace(/\\/g, "/").replace(/\/+$/, "") || "/";

export function threadBelongsToProject(thread: SessionThread, project: SessionProject): boolean {
  if (!thread.cwd) return false;
  const cwd = normalizedPath(thread.cwd);
  const root = normalizedPath(project.root);
  // A terminal can be started from a workspace parent while the writable
  // project root is a child (runtimeWorkspaceRoots is not exposed by thread/list).
  return cwd === root || cwd.startsWith(`${root}/`) || root.startsWith(`${cwd}/`);
}

export function threadsForProject<T extends SessionThread>(threads: T[], project?: SessionProject): T[] {
  return project ? threads.filter((thread) => threadBelongsToProject(thread, project)) : threads;
}

export function threadListParams(cursor?: string | null, archived = false): Record<string, unknown> {
  return {
    ...(cursor ? { cursor } : {}),
    limit: 100,
    archived,
    sortKey: "updated_at",
    sortDirection: "desc"
  };
}

export function projectForThread(projects: readonly SessionProject[], thread?: SessionThread | null): SessionProject | undefined {
  if (!thread) return undefined;
  return projects.find((project) => threadBelongsToProject(thread, project));
}

export function sessionLocation(projects: readonly SessionProject[], thread: SessionThread): string {
  return projectForThread(projects, thread)?.name ?? thread.cwd ?? "Unknown location";
}
