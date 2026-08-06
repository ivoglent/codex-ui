import { describe, expect, it } from "vitest";
import { projectForThread, sessionLocation, threadListParams } from "./session-scope";

const projects = [{ id: "codex-ui", name: "Codex UI", root: "/workspace/codex-ui" }];

describe("session scope", () => {
  it("omits cwd when listing all sessions", () => {
    expect(threadListParams()).not.toHaveProperty("cwd");
    expect(threadListParams()).toMatchObject({ limit: 100, archived: false, sortKey: "updated_at", sortDirection: "desc" });
  });

  it("filters by cwd for a concrete project", () => {
    expect(threadListParams(projects[0])).toMatchObject({ cwd: "/workspace/codex-ui" });
  });

  it("labels repository and unmatched workspace sessions", () => {
    expect(projectForThread(projects, { cwd: "/workspace/codex-ui/apps/web" })?.id).toBe("codex-ui");
    expect(sessionLocation(projects, { cwd: "/workspace" })).toBe("/workspace");
  });
});
