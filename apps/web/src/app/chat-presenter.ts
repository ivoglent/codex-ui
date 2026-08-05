import type { UiEvent } from "./connection.service";

export type ChatKind = "user" | "assistant" | "progress" | "command" | "change" | "error";
export interface ChatItem { key: string; kind: ChatKind; title?: string; body: string; status?: string }

const userText = (content: any[]): string => content.map((part) => {
  if (part.type === "text") return part.text;
  if (part.type === "skill") return `$${part.name}`;
  if (part.type === "mention") return `@${part.name}`;
  return part.path ?? part.url ?? `[${part.type}]`;
}).join("\n");

function presentThreadItem(item: any): ChatItem | null {
  const key = `item:${item.id ?? item.type}`;
  if (item.type === "userMessage") return { key, kind: "user", body: userText(item.content ?? []) };
  if (item.type === "agentMessage") return { key, kind: "assistant", body: item.text ?? "" };
  if (item.type === "reasoning") return { key, kind: "progress", title: "Reasoning", body: [...(item.summary ?? []), ...(item.content ?? [])].join("\n") };
  if (item.type === "plan") return { key, kind: "progress", title: "Plan", body: item.text ?? "" };
  if (item.type === "commandExecution") return { key, kind: "command", title: item.command ?? "Command", body: item.aggregatedOutput ?? "", status: item.status };
  if (item.type === "fileChange") return { key, kind: "change", title: `${item.changes?.length ?? 0} file change${item.changes?.length === 1 ? "" : "s"}`, body: (item.changes ?? []).map((change: any) => `${change.kind}: ${change.path}${change.diff ? `\n${change.diff}` : ""}`).join("\n\n"), status: item.status };
  if (item.type === "mcpToolCall" || item.type === "dynamicToolCall") return { key, kind: "command", title: `${item.server ? `${item.server} · ` : ""}${item.tool}`, body: item.error?.message ?? "", status: item.status };
  if (item.type === "webSearch") return { key, kind: "command", title: "Web search", body: item.query ?? "", status: item.status };
  return null;
}

function eventItem(event: UiEvent): ChatItem | null {
  const params = event.params ?? {};
  if (event.method === "item/completed" || event.method === "item/started") return presentThreadItem(params.item);
  if (event.method === "item/agentMessage/delta") return { key: `delta:${params.itemId ?? event.sequence}`, kind: "assistant", body: params.delta ?? "" };
  if (event.method?.includes("reasoning") && event.method.endsWith("Delta")) return { key: `delta:${params.itemId ?? event.sequence}`, kind: "progress", title: "Reasoning", body: params.delta ?? "" };
  if (event.method === "turn/plan/updated") return { key: `plan:${params.turnId ?? event.sequence}`, kind: "progress", title: "Plan updated", body: typeof params.plan === "string" ? params.plan : JSON.stringify(params.plan ?? "", null, 2) };
  if (event.method === "turn/diff/updated") return { key: `diff:${params.turnId ?? event.sequence}`, kind: "change", title: "Working changes", body: params.diff ?? "" };
  if (event.method?.includes("outputDelta")) return { key: `delta:${params.itemId ?? params.processId ?? event.sequence}`, kind: "command", title: "Command output", body: params.delta ?? "" };
  if (event.method === "turn/started") return { key: `turn:${params.turn?.id ?? event.sequence}`, kind: "progress", title: "Codex is working", body: "Analyzing the request and workspace…", status: "inProgress" };
  if (event.method === "turn/completed") return { key: `turn:${params.turn?.id ?? event.sequence}`, kind: params.turn?.status === "failed" ? "error" : "progress", title: params.turn?.status === "failed" ? "Turn failed" : "Turn complete", body: params.turn?.error?.message ?? "", status: params.turn?.status };
  if (event.method === "error" || event.method === "warning" || event.method === "guardianWarning") return { key: `notice:${event.sequence}`, kind: event.method === "error" ? "error" : "progress", title: event.method === "error" ? "Error" : "Warning", body: params.message ?? params.error?.message ?? String(params) };
  return null;
}

export function buildChatItems(thread: any, events: UiEvent[]): ChatItem[] {
  const result: ChatItem[] = [];
  const itemIndexes = new Map<string, number>();
  const append = (item: ChatItem | null) => {
    if (!item || (!item.body && !item.title)) return;
    const existing = itemIndexes.get(item.key);
    if (existing !== undefined) {
      if (item.key.startsWith("delta:")) result[existing] = { ...result[existing], body: `${result[existing].body}${item.body}` };
      else result[existing] = item;
      return;
    }
    itemIndexes.set(item.key, result.length);
    result.push(item);
  };
  for (const turn of thread?.turns ?? []) {
    for (const item of turn.items ?? []) append(presentThreadItem(item));
    if (turn.status === "failed") append({ key: `turn-error:${turn.id}`, kind: "error", title: "Turn failed", body: turn.error?.message ?? "The turn failed." });
  }
  for (const event of events) append(eventItem(event));
  return result;
}
