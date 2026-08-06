import { describe, expect, it } from "vitest";
import { projectForThread, sessionLocation, threadBelongsToProject, threadListParams, threadsForProject } from "./session-scope";

const projects = [{ id: "codex-ui", name: "Codex UI", root: "/workspace/codex-ui" }];

describe("session scope", () => {
  it("builds a first page for active sessions", () => {
    expect(threadListParams()).not.toHaveProperty("cwd");
    expect(threadListParams()).toMatchObject({ limit: 100, archived: false, sortKey: "updated_at", sortDirection: "desc" });
  });

  it("builds subsequent and archived pages", () => {
    expect(threadListParams("next-page")).toMatchObject({ cursor: "next-page", archived: false });
    expect(threadListParams(null, true)).toMatchObject({ archived: true });
  });

  it("labels project-overlapping and unrelated workspace sessions", () => {
    expect(projectForThread(projects, { cwd: "/workspace/codex-ui/apps/web" })?.id).toBe("codex-ui");
    expect(sessionLocation(projects, { cwd: "/workspace" })).toBe("Codex UI");
    expect(sessionLocation(projects, { cwd: "/opt/unrelated" })).toBe("/opt/unrelated");
  });

  it("keeps descendant working directories in their project scope", () => {
    const root = projects[0];
    const threads = [{ id: "root", cwd: "/workspace/codex-ui" }, { id: "nested", cwd: "/workspace/codex-ui/apps/web" }, { id: "other", cwd: "/workspace/other" }];
    expect(threadBelongsToProject(threads[1], root)).toBe(true);
    expect(threadsForProject(threads, root).map((thread) => thread.id)).toEqual(["root", "nested"]);
  });

  it("normalizes trailing and Windows-style separators", () => {
    expect(threadBelongsToProject({ cwd: "C:\\work\\codex-ui\\apps\\web" }, { id: "p", name: "p", root: "C:\\work\\codex-ui\\" })).toBe(true);
  });

  it("includes a project when the terminal session started from its workspace parent", () => {
    expect(threadBelongsToProject({ cwd: "/home/ivoglent/works" }, {
      id: "codex-ui", name: "Codex UI", root: "/home/ivoglent/works/codex-ui"
    })).toBe(true);
    expect(threadBelongsToProject({ cwd: "/home/ivoglent/workshop" }, {
      id: "codex-ui", name: "Codex UI", root: "/home/ivoglent/works/codex-ui"
    })).toBe(false);
  });
});
