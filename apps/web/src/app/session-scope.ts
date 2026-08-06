export const ALL_SESSIONS_ID = "__all__";

export interface SessionProject { id: string; name: string; root: string; [key: string]: unknown }
export interface SessionThread { cwd?: string | null; [key: string]: unknown }

export function threadListParams(project?: SessionProject): Record<string, unknown> {
  return {
    ...(project ? { cwd: project.root } : {}),
    limit: 100,
    archived: false,
    sortKey: "updated_at",
    sortDirection: "desc"
  };
}

export function projectForThread(projects: readonly SessionProject[], thread?: SessionThread | null): SessionProject | undefined {
  const cwd = thread?.cwd;
  if (!cwd) return undefined;
  return projects.find((project) => cwd === project.root || cwd.startsWith(`${project.root}/`));
}

export function sessionLocation(projects: readonly SessionProject[], thread: SessionThread): string {
  return projectForThread(projects, thread)?.name ?? thread.cwd ?? "Unknown location";
}
