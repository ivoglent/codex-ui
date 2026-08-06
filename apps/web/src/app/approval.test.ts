import { describe, expect, it } from "vitest";
import { approvalResult, supportsSessionApproval } from "./approval";

describe("approvalResult", () => {
  it("uses v2 decisions for modern command approvals", () => {
    expect(approvalResult("item/commandExecution/requestApproval", {}, "acceptForSession")).toEqual({ decision: "acceptForSession" });
  });

  it("uses legacy review decisions for legacy command approvals", () => {
    expect(approvalResult("execCommandApproval", {}, "accept")).toEqual({ decision: "approved" });
    expect(approvalResult("execCommandApproval", {}, "acceptForSession")).toEqual({ decision: "approved_for_session" });
    expect(approvalResult("applyPatchApproval", {}, "decline")).toEqual({ decision: { denied: { rejection: "Declined in Codex UI" } } });
  });

  it("offers session approval only where the protocol supports it", () => {
    expect(supportsSessionApproval("item/fileChange/requestApproval")).toBe(true);
    expect(supportsSessionApproval("item/tool/call")).toBe(false);
  });
});
