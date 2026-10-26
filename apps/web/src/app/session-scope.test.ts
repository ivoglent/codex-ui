import { describe, expect, it } from "vitest";
import { latestThreads, mergeSessionMetadata, projectForThread, RECENT_THREAD_LIMIT, sessionLocation, sortThreads, threadActivityAt, threadBelongsToProject, threadListParams, threadsForProject } from "./session-scope";

const projects = [{ id: "codex-ui", name: "Codex UI", root: "/workspace/codex-ui" }];

describe("session scope", () => {
  it("builds a first page for active sessions", () => {
    expect(threadListParams()).not.toHaveProperty("cwd");
    expect(threadListParams()).toMatchObject({ limit: RECENT_THREAD_LIMIT, archived: false, sortKey: "updated_at", sortDirection: "desc" });
  });

  it("builds subsequent and archived pages", () => {
    expect(threadListParams("next-page")).toMatchObject({ cursor: "next-page", archived: false });
    expect(threadListParams(null, true)).toMatchObject({ archived: true });
  });

  it("labels project-overlapping and unrelated workspace sessions", () => {
    expect(projectForThread(projects, { cwd: "/workspace/codex-ui/apps/web" })?.id).toBe("codex-ui");
    expect(sessionLocation(projects, { cwd: "/workspace" })).toBe("/workspace");
    expect(sessionLocation(projects, { cwd: "/opt/unrelated" })).toBe("/opt/unrelated");
  });

  it("keeps descendant working directories in their project scope", () => {
    const root = projects[0];
    const threads = [{ id: "root", cwd: "/workspace/codex-ui" }, { id: "nested", cwd: "/workspace/codex-ui/apps/web" }, { id: "other", cwd: "/workspace/other" }];
    expect(threadBelongsToProject(threads[1], root)).toBe(true);
    expect(threadsForProject(threads, root).map((thread) => thread.id)).toEqual(["root", "nested"]);
  });

  it("keeps only the most recently active sessions", () => {
    const threads = Array.from({ length: RECENT_THREAD_LIMIT + 2 }, (_, index) => ({ id: `thread-${index}`, updatedAt: index }));
    const latest = latestThreads(threads);
    expect(latest).toHaveLength(RECENT_THREAD_LIMIT);
    expect(latest[0].id).toBe(`thread-${RECENT_THREAD_LIMIT + 1}`);
    expect(latest.at(-1)?.id).toBe("thread-2");
  });

  it("sorts a loaded follow-up page without discarding prior sessions", () => {
    expect(sortThreads([{ id: "older", updatedAt: 1 }, { id: "newer", updatedAt: 2 }]).map((thread) => thread.id)).toEqual(["newer", "older"]);
  });

  it("updates an open session from a refresh without dropping its loaded turns", () => {
    const current = { id: "open", status: "active", turns: [{ id: "turn-1" }] };
    expect(mergeSessionMetadata(current, { id: "open", status: "completed", updatedAt: 42 })).toEqual({ id: "open", status: "completed", updatedAt: 42, turns: current.turns });
  });

  it("uses a session's updated time for project activity", () => {
    expect(threadActivityAt({ updatedAt: "2026-08-21T10:00:00.000Z" })).toBe(Date.parse("2026-08-21T10:00:00.000Z"));
    expect(threadActivityAt({ createdAt: 42 })).toBe(42);
  });

  it("normalizes trailing and Windows-style separators", () => {
    expect(threadBelongsToProject({ cwd: "C:\\work\\codex-ui\\apps\\web" }, { id: "p", name: "p", root: "C:\\work\\codex-ui\\" })).toBe(true);
  });

  it("does not assign a parent workspace session to every child project", () => {
    expect(threadBelongsToProject({ cwd: "/home/example/works" }, {
      id: "codex-ui", name: "Codex UI", root: "/home/example/works/codex-ui"
    })).toBe(false);
    expect(threadBelongsToProject({ cwd: "/home/example/workshop" }, {
      id: "codex-ui", name: "Codex UI", root: "/home/example/works/codex-ui"
    })).toBe(false);
  });
});
