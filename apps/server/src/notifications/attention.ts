import { createHash } from "node:crypto";

export type AttentionCategory = "approval" | "input" | "completed" | "failed" | "system" | "account";
export interface AttentionItem { id: string; category: AttentionCategory; priority: "normal" | "high"; method: string; threadId?: string; turnId?: string; createdAt: string; resolvedAt?: string; requestKey?: string }
export class AttentionCoordinator {
  private readonly items = new Map<string, AttentionItem>();
  add(method: string, params: any, requestKey?: string): AttentionItem | null {
    const category = this.category(method); if (!category) return null;
    const stable = requestKey ?? `${method}:${params?.threadId ?? ""}:${params?.turnId ?? ""}:${params?.turn?.id ?? ""}`;
    const id = createHash("sha256").update(stable).digest("hex").slice(0, 20);
    const existing = this.items.get(id); if (existing) return existing;
    const item: AttentionItem = { id, category, priority: category === "failed" || category === "approval" || category === "input" ? "high" : "normal", method, threadId: params?.threadId, turnId: params?.turnId ?? params?.turn?.id, createdAt: new Date().toISOString(), requestKey };
    this.items.set(id, item); return item;
  }
  resolveRequest(requestKey: string): void { for (const item of this.items.values()) if (item.requestKey === requestKey && !item.resolvedAt) item.resolvedAt = new Date().toISOString(); }
  list(): AttentionItem[] { return [...this.items.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500); }
  counts(): Record<string, number> { return this.list().filter((item) => !item.resolvedAt).reduce<Record<string,number>>((out, item) => { out[item.category] = (out[item.category] ?? 0) + 1; return out; }, {}); }
  private category(method: string): AttentionCategory | null { if (method.includes("requestApproval")) return "approval"; if (method.includes("requestUserInput") || method.includes("elicitation")) return "input"; if (method === "turn/completed") return "completed"; if (method === "error" || method.includes("failed")) return "failed"; if (method.includes("rateLimits") || method.includes("account")) return "account"; if (method === "warning") return "system"; return null; }
}
