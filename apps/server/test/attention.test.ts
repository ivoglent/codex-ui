import { describe, expect, it } from "vitest";
import { AttentionCoordinator } from "../src/notifications/attention.js";
describe("AttentionCoordinator", () => {
  it("deduplicates replayed requests and resolves them", () => { const coordinator = new AttentionCoordinator(); const first = coordinator.add("item/commandExecution/requestApproval", { threadId: "t", turnId: "v" }, "key"); const duplicate = coordinator.add("item/commandExecution/requestApproval", { threadId: "t", turnId: "v" }, "key"); expect(first).toBe(duplicate); expect(coordinator.counts().approval).toBe(1); coordinator.resolveRequest("key"); expect(coordinator.counts().approval).toBeUndefined(); });
  it("keeps failed turns as attention", () => { const coordinator = new AttentionCoordinator(); coordinator.add("turn/failed", { threadId: "t", turnId: "v" }); expect(coordinator.counts().failed).toBe(1); });
});
