export interface SelectorProject { id: string; name?: string; aliases?: string[]; recentAt?: number }

export function projectLabel(project: Partial<SelectorProject> | string | null | undefined): string {
  const value = typeof project === "string" ? project : project?.name ?? "";
  return value.replace(/^\s*Project\s*(?:[-·•:])\s*/i, "").trim() || "All sessions";
}

export function sessionTitle(thread: any): string {
  let value = thread?.name || thread?.preview || thread?.firstPrompt || "";
  value = String(value)
    .replace(/^\s*(?:[$#>] ?|\w+@[\w.-]+(?::[^\n]*?)?[$#]\s+)/, "")
    .replace(/^\s*Project\s*(?:[-·•:])\s*/i, "")
    .replace(/\s+/g, " ").trim();
  if (!value || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)) return "Untitled session";
  return value.length > 72 ? `${value.slice(0, 69)}…` : value;
}

export function filterProjects<T extends SelectorProject>(projects: T[], query: string): T[] {
  const needle = query.trim().toLocaleLowerCase();
  return [...projects].filter((project) => !needle || [projectLabel(project), ...(project.aliases ?? [])]
    .some((label) => label.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => (b.recentAt ?? 0) - (a.recentAt ?? 0) || projectLabel(a).localeCompare(projectLabel(b)));
}

export type SessionGroup = "Needs attention" | "Running" | "Recent" | "Archived";
export function sessionGroup(thread: any): SessionGroup {
  const status = String(thread?.status?.type ?? thread?.status ?? "idle").toLowerCase();
  if (thread?.archived || status === "archived") return "Archived";
  if (["failed", "interrupted", "approval", "waitingforapproval", "needsinput"].includes(status)) return "Needs attention";
  if (["active", "inprogress", "running"].includes(status)) return "Running";
  return "Recent";
}

export function groupSessions(threads: any[], includeArchived = false): Array<{ name: SessionGroup; items: any[] }> {
  const order: SessionGroup[] = ["Needs attention", "Running", "Recent", "Archived"];
  return order.map((name) => ({ name, items: threads.filter((thread) => sessionGroup(thread) === name) }))
    .filter((group) => group.items.length && (includeArchived || group.name !== "Archived"));
}
