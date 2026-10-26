export const ALL_SESSIONS_ID = "__all__";
export const RECENT_THREAD_LIMIT = 50;

export interface SessionProject { id: string; name: string; root: string; [key: string]: unknown }
export interface SessionThread { cwd?: string | null; [key: string]: unknown }

const normalizedPath = (value: string): string => value.replace(/\\/g, "/").replace(/\/+$/, "") || "/";

export function threadBelongsToProject(thread: SessionThread, project: SessionProject): boolean {
  if (!thread.cwd) return false;
  const cwd = normalizedPath(thread.cwd);
  const root = normalizedPath(project.root);
  return cwd === root || cwd.startsWith(`${root}/`);
}

export function threadsForProject<T extends SessionThread>(threads: T[], project?: SessionProject): T[] {
  return project ? threads.filter((thread) => threadBelongsToProject(thread, project)) : threads;
}

export function sortThreads<T extends SessionThread>(threads: T[]): T[] {
  return [...threads]
    .sort((left: any, right: any) => threadActivityAt(right) - threadActivityAt(left) || String(left.id ?? "").localeCompare(String(right.id ?? "")))
}

export function latestThreads<T extends SessionThread>(threads: T[], limit = RECENT_THREAD_LIMIT): T[] {
  return sortThreads(threads).slice(0, limit);
}

/** Merge server metadata without replacing the locally rendered turn cache. */
export function mergeSessionMetadata<T extends SessionThread>(current: T, refreshed: T): T {
  return { ...current, ...refreshed, ...(Object.prototype.hasOwnProperty.call(current, "turns") ? { turns: (current as any).turns } : {}) } as T;
}

export function threadListParams(cursor?: string | null, archived = false): Record<string, unknown> {
  return {
    ...(cursor ? { cursor } : {}),
    limit: RECENT_THREAD_LIMIT,
    archived,
    sortKey: "updated_at",
    sortDirection: "desc"
  };
}

export function threadActivityAt(thread: any): number {
  for (const value of [thread?.updatedAt, thread?.updated_at, thread?.createdAt, thread?.created_at]) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const timestamp = Date.parse(value);
      if (Number.isFinite(timestamp)) return timestamp;
    }
  }
  return 0;
}

export function projectForThread(projects: readonly SessionProject[], thread?: SessionThread | null): SessionProject | undefined {
  if (!thread) return undefined;
  return projects.find((project) => threadBelongsToProject(thread, project));
}

export function sessionLocation(projects: readonly SessionProject[], thread: SessionThread): string {
  return projectForThread(projects, thread)?.name ?? thread.cwd ?? "Unknown location";
}
