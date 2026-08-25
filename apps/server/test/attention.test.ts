import { describe, expect, it, vi } from "vitest";
import { AttentionCoordinator, type AttentionItem } from "../src/notifications/attention.js";

describe("AttentionCoordinator", () => {
  it("deduplicates replayed requests and resolves them", () => {
    const coordinator = new AttentionCoordinator();
    const first = coordinator.add("item/commandExecution/requestApproval", { threadId: "t", turnId: "v" }, "key");
    const duplicate = coordinator.add("item/commandExecution/requestApproval", { threadId: "t", turnId: "v" }, "key");
    expect(first).toBe(duplicate);
    expect(coordinator.counts().approval).toBe(1);
    coordinator.resolveRequest("key");
    expect(coordinator.counts().approval).toBeUndefined();
  });

  it("keeps failed turns as attention", () => {
    const coordinator = new AttentionCoordinator();
    coordinator.add("turn/failed", { threadId: "t", turnId: "v" });
    expect(coordinator.counts().failed).toBe(1);
  });

  it("emits only fresh items to listeners", () => {
    const coordinator = new AttentionCoordinator();
    const seen: AttentionItem[] = [];
    coordinator.onItem((item) => seen.push(item));

    coordinator.add("item/commandExecution/requestApproval", { threadId: "t", turnId: "v" });
    coordinator.add("item/commandExecution/requestApproval", { threadId: "t", turnId: "v" }); // dedup, no listener call
    coordinator.add("turn/completed", { threadId: "t", turnId: "v-2" });

    expect(seen).toHaveLength(2);
    expect(seen.map((item) => item.category)).toEqual(["approval", "completed"]);
  });

  it("isolates listener errors from the add() return value", () => {
    const coordinator = new AttentionCoordinator();
    const spy = vi.fn(() => {
      throw new Error("boom");
    });
    coordinator.onItem(spy);
    const item = coordinator.add("turn/completed", { threadId: "t", turnId: "v" });
    expect(spy).toHaveBeenCalled();
    expect(item?.category).toBe("completed");
  });
});
