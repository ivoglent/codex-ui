import type { UiEvent } from "./connection.service";

export type ChatKind = "user" | "assistant" | "reasoning" | "plan" | "command" | "change" | "review" | "warning" | "error" | "status";
export interface ChatItem { key: string; kind: ChatKind; title?: string; body: string; status?: string; meta?: any }

const userContent = (content: any[]) => ({
  body: content.filter((part) => part.type !== "image").map((part) => part.type === "text" ? part.text : part.type === "skill" ? `$${part.name}` : part.type === "mention" ? `@${part.name}` : part.path ?? part.url ?? `[${part.type}]`).join("\n"),
  images: content.filter((part) => part.type === "image" && typeof part.url === "string" && part.url.startsWith("data:image/")).map((part) => part.url)
});
const duration = (ms: number | null | undefined) => ms == null ? "" : ms < 1000 ? `${ms}ms` : `${Math.round(ms / 100) / 10}s`;

function presentThreadItem(item: any, turnId = "unknown"): ChatItem | null {
  const key = `item:${item.id ?? item.type}`;
  if (item.type === "userMessage") {
    const content = userContent(item.content ?? []);
    return { key, kind: "user", body: content.body, meta: content.images.length ? { images: content.images } : undefined };
  }
  if (item.type === "agentMessage") return { key, kind: item.phase === "review" ? "review" : "assistant", title: item.phase === "review" ? "Review" : undefined, body: item.text ?? "" };
  if (item.type === "reasoning") return { key, kind: "reasoning", title: "Reasoning summary", body: (item.summary ?? []).join("\n") };
  if (item.type === "plan") return { key: `plan:${turnId}`, kind: "plan", title: "Plan", body: item.text ?? "", meta: { steps: item.steps } };
  if (item.type === "commandExecution") return { key, kind: "command", title: item.command ?? "Command", body: item.aggregatedOutput ?? "", status: item.status, meta: { command: item.command, cwd: item.cwd, exitCode: item.exitCode, duration: duration(item.durationMs) } };
  if (item.type === "fileChange") return { key: `changes:${turnId}`, kind: "change", title: "Files changed", body: "", status: item.status, meta: { changes: item.changes ?? [] } };
  if (item.type === "mcpToolCall" || item.type === "dynamicToolCall") return { key, kind: "command", title: `${item.server ? `${item.server} · ` : ""}${item.tool}`, body: item.error?.message ?? "", status: item.status, meta: { command: item.tool, duration: duration(item.durationMs) } };
  if (item.type === "webSearch") return { key, kind: "command", title: "Web search", body: item.query ?? "", status: item.status };
  if (item.type === "enteredReviewMode" || item.type === "exitedReviewMode") return { key, kind: "review", title: "Review", body: item.review ?? "" };
  return null;
}

function eventItem(event: UiEvent): ChatItem | null {
  const params = event.params ?? {}; const turnId = params.turnId ?? params.turn?.id ?? "live";
  if (event.method === "item/completed" || event.method === "item/started") return presentThreadItem(params.item, turnId);
  if (event.method === "item/agentMessage/delta") return { key: `delta:${params.itemId ?? event.sequence}`, kind: "assistant", body: params.delta ?? "" };
  if (event.method?.includes("reasoning") && event.method.endsWith("Delta")) return { key: `delta:${params.itemId ?? event.sequence}`, kind: "reasoning", title: "Reasoning summary", body: params.delta ?? "" };
  if (event.method === "turn/plan/updated") return { key: `plan:${turnId}`, kind: "plan", title: "Plan", body: "", meta: { steps: params.plan ?? [] } };
  if (event.method === "turn/diff/updated") return { key: `diff:${turnId}`, kind: "change", title: "Working changes", body: params.diff ?? "", meta: { diff: params.diff ?? "", changes: [] } };
  if (event.method?.includes("outputDelta")) return { key: `delta:${params.itemId ?? params.processId ?? event.sequence}`, kind: "command", title: "Command output", body: params.delta ?? "", status: "inProgress" };
  if (event.method === "turn/started") return { key: `turn:${turnId}`, kind: "status", title: "Codex is working", body: "Preparing the next response…", status: "inProgress" };
  if (event.method === "turn/completed") return { key: `turn:${turnId}`, kind: params.turn?.status === "failed" ? "error" : "status", title: params.turn?.status === "failed" ? "Turn failed" : "Turn complete", body: params.turn?.error?.message ?? "", status: params.turn?.status };
  if (event.method === "error" || event.method === "warning" || event.method === "guardianWarning") return { key: `notice:${event.sequence}`, kind: event.method === "error" ? "error" : "warning", title: event.method === "error" ? "Request failed" : "Warning", body: params.message ?? params.error?.message ?? "Codex reported a problem." };
  return null;
}

export function buildChatItems(thread: any, events: UiEvent[]): ChatItem[] {
  const result: ChatItem[] = []; const indexes = new Map<string, number>();
  const append = (item: ChatItem | null) => {
    if (!item || (!item.body && !item.title && !item.meta)) return;
    if (item.kind === "user" && !item.key.includes("local-")) {
      const optimistic = result.findIndex((existing) => existing.kind === "user" && existing.key.includes("local-") && existing.body === item.body && JSON.stringify(existing.meta?.images ?? []) === JSON.stringify(item.meta?.images ?? []));
      if (optimistic >= 0) { indexes.delete(result[optimistic].key); result[optimistic] = item; indexes.set(item.key, optimistic); return; }
    }
    const existing = indexes.get(item.key);
    if (existing !== undefined) {
      if (item.key.startsWith("delta:")) result[existing] = { ...result[existing], body: `${result[existing].body}${item.body}`, status: item.status };
      else if (item.kind === "change" && item.meta?.changes?.length) {
        const changes = [...(result[existing].meta?.changes ?? []), ...item.meta.changes];
        result[existing] = { ...item, meta: { ...item.meta, changes: [...new Map(changes.map((change: any) => [change.path, change])).values()] } };
      } else result[existing] = item;
      return;
    }
    indexes.set(item.key, result.length); result.push(item);
  };
  for (const turn of thread?.turns ?? []) {
    for (const item of turn.items ?? []) append(presentThreadItem(item, turn.id));
    if (turn.status === "failed") append({ key: `turn-error:${turn.id}`, kind: "error", title: "Turn failed", body: turn.error?.message ?? "The turn failed." });
  }
  for (const event of events) append(eventItem(event));
  return result;
}
