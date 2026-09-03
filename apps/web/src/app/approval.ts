export type ApprovalDecision = "accept" | "acceptForSession" | "decline";

export function approvalResult(method: string, params: any, decision: ApprovalDecision): unknown {
  if (method === "execCommandApproval" || method === "applyPatchApproval") {
    return { decision: decision === "acceptForSession" ? "approved_for_session" : decision === "accept" ? "approved" : { denied: { rejection: "Declined in Codex UI" } } };
  }
  if (method === "item/tool/requestUserInput") return { answers: {} };
  if (method === "mcpServer/elicitation/request") return { action: decision === "acceptForSession" ? "accept" : decision, content: null, _meta: null };
  if (method === "item/permissions/requestApproval") return { permissions: decision.startsWith("accept") ? { network: params?.permissions?.network, fileSystem: params?.permissions?.fileSystem } : {}, scope: decision === "acceptForSession" ? "session" : "turn" };
  if (method === "item/tool/call") return { contentItems: [], success: decision.startsWith("accept") };
  return { decision };
}

export function supportsSessionApproval(method: string): boolean {
  return ["execCommandApproval", "applyPatchApproval", "item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/permissions/requestApproval"].includes(method);
}
