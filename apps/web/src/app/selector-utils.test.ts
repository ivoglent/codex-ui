import { describe, expect, it } from "vitest";
import { filterProjects, groupSessions, projectLabel, sessionTitle } from "./selector-utils";

describe("selector formatting and grouping", () => {
  it("normalizes display labels without changing canonical ids", () => {
    const project = { id: "canonical-id", name: "Project - trading-workers" };
    expect(projectLabel(project)).toBe("trading-workers");
    expect(project.id).toBe("canonical-id");
    expect(sessionTitle({ name: "$   Project · Fix   approval workflow" })).toBe("Fix approval workflow");
    expect(sessionTitle({ name: "2f1c0f34-1234-4567-89ab-123456789abc" })).toBe("Untitled session");
  });

  it("searches aliases case-insensitively and orders recent projects first", () => {
    const projects = [{ id: "a", name: "Project - Zebra", aliases: ["workers"], recentAt: 2 }, { id: "b", name: "alpha", recentAt: 1 }];
    expect(filterProjects(projects, "WORK").map((item) => item.id)).toEqual(["a"]);
    expect(filterProjects(projects, "").map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("groups attention, running and recent sessions and hides archived by default", () => {
    const threads = [{ id: "a", status: "failed" }, { id: "b", status: "inProgress" }, { id: "c", status: "idle" }, { id: "d", status: "archived" }];
    expect(groupSessions(threads).map((group) => group.name)).toEqual(["Needs attention", "Running", "Recent"]);
    expect(groupSessions(threads, true).at(-1)?.name).toBe("Archived");
  });
});
