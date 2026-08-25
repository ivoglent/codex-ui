import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { BrowserInbound, ScheduleRecord } from "@codex-control/shared";
import type { AppServerSupervisor } from "../codex/supervisor.js";
import type { ProjectRegistry } from "../config/projects.js";
import { EventStream } from "./event-stream.js";
import { AttentionCoordinator } from "../notifications/attention.js";
import { Metrics } from "../observability/metrics.js";
import { accessTokenFingerprint, accessTokenFromCookie, NotificationDispatcher } from "../notifications/dispatcher.js";

const allowedMethods = new Set([
  "thread/start", "thread/resume", "thread/fork", "thread/read", "thread/list", "thread/turns/list", "thread/items/list", "thread/name/set", "thread/goal/set", "thread/goal/get", "thread/goal/clear", "thread/metadata/update", "thread/archive", "thread/unarchive", "thread/delete", "thread/unsubscribe", "thread/compact/start",
  "turn/start", "turn/steer", "turn/interrupt", "review/start", "model/list", "modelProvider/capabilities/read", "permissionProfile/list", "collaborationMode/list", "experimentalFeature/list", "experimentalFeature/enablement/set", "skills/list", "hooks/list", "mcpServerStatus/list", "mcpServer/oauth/login", "config/mcpServer/reload", "app/installed", "app/list", "app/read", "account/read", "account/rateLimits/read", "account/usage/read", "account/workspaceMessages/read", "config/read", "config/value/write", "config/batchWrite"
]);
const configKeyAllowlist = ["model", "model_reasoning_effort", "model_reasoning_summary", "personality", "approval_policy", "sandbox_mode", "features.apps", "features.plugins"];

export class BrowserHub {
  private readonly wss: WebSocketServer; private readonly stream: EventStream; private readonly pending = new Map<string, { id: number | string; method: string; params: unknown }>(); private readonly attention = new AttentionCoordinator(); private readonly observedThreads = new Map<string, unknown>(); private readonly sessionTokens = new Map<WebSocket, string>();
  constructor(server: Server, private readonly supervisor: AppServerSupervisor, private readonly projects: ProjectRegistry, readonly metrics = new Metrics(), origin?: string, capacity = 10_000, private readonly dispatcher?: NotificationDispatcher) {
    this.stream = new EventStream(capacity); this.wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
    server.on("upgrade", (request, socket, head) => {
      if (request.url !== "/ws" || (origin && request.headers.origin !== origin)) return socket.destroy();
      this.wss.handleUpgrade(request, socket, head, (client) => this.wss.emit("connection", client, request));
    });
    this.wss.on("connection", (client, request: IncomingMessage) => { this.metrics.clients++; const token = accessTokenFromCookie(request.headers.cookie); if (token) this.sessionTokens.set(client, token); client.once("close", () => { this.metrics.clients--; this.sessionTokens.delete(client); }); client.on("message", (data) => void this.receive(client, data.toString())); });
    supervisor.on("notification", (method, params) => {
      this.metrics.notifications++;
      if (method === "thread/started") this.rememberThread((params as any)?.thread);
      if (method === "serverRequest/resolved") {
        const requestId = (params as any)?.requestId;
        const resolved = [...this.pending].find(([, value]) => String(value.id) === String(requestId));
        if (resolved) {
          this.pending.delete(resolved[0]); this.attention.resolveRequest(resolved[0]);
          this.broadcast(this.stream.append("attention.changed", { requestKey: resolved[0], resolved: true, counts: this.attention.counts() }));
        }
      }
      const item = this.attention.add(method, params); this.broadcast(this.stream.append("codex.event", { method, params })); if (item) this.dispatch(item);
      if (item) this.broadcast(this.stream.append("attention.changed", { item, counts: this.attention.counts() }));
    });
    supervisor.on("serverRequest", (id, method, params) => { const requestKey = randomUUID(); this.pending.set(requestKey, { id, method, params }); const item = this.attention.add(method, params, requestKey); this.broadcast(this.stream.append("codex.serverRequest", { requestKey, method, params, expiresAt: null })); if (item) { this.broadcast(this.stream.append("attention.changed", { item, counts: this.attention.counts() })); this.dispatch(item); } });
    supervisor.on("status", (status) => this.broadcast(this.stream.append("system.status", { status })));
  }
  close(): void { this.wss.close(); }
  projectsChanged(): void { this.broadcast(this.snapshot()); }
  broadcastScheduleChange(schedule: ScheduleRecord): void { this.broadcast(this.stream.append("schedule.changed", { schedule })); }
  /**
   * Reconcile the app-server's list with thread IDs announced while this shared
   * server has been running. `thread/list` can lag a freshly started remote CLI
   * session, while `thread/read` can already retrieve it.
   */
  async scanSessions(): Promise<{ data: unknown[] }> {
    const listed = new Map<string, any>();
    for (const archived of [false, true]) {
      let cursor: string | null = null;
      const cursors = new Set<string>();
      do {
        const page: { data?: any[]; nextCursor?: string | null } = await this.supervisor.broker.request("thread/list", { ...(cursor ? { cursor } : {}), limit: 100, archived, sortKey: "updated_at", sortDirection: "desc" });
        for (const thread of page?.data ?? []) this.rememberThread(thread), listed.set(thread.id, thread);
        cursor = page?.nextCursor ?? null;
        if (cursor && cursors.has(cursor)) throw new Error("Codex returned a repeated session-list cursor");
        if (cursor) cursors.add(cursor);
      } while (cursor);
    }
    for (const id of this.observedThreads.keys()) {
      if (listed.has(id)) continue;
      try {
        const result = await this.supervisor.broker.request<any>("thread/read", { threadId: id });
        const thread = result?.thread;
        if (thread?.id === id) this.rememberThread(thread), listed.set(id, thread);
      } catch {
        // A deleted or not-yet-readable thread must not prevent other sessions from appearing.
      }
    }
    return { data: [...listed.values()] };
  }
  private snapshot() { return { type: "system.snapshot", generationId: this.stream.generationId, sequence: this.stream.sequence, appServer: this.supervisor.status, projects: this.projects.projects, pendingRequests: [...this.pending].map(([requestKey, value]) => ({ type: "codex.serverRequest", requestKey, method: value.method, params: value.params, expiresAt: null })), attention: this.attention.list(), attentionCounts: this.attention.counts() }; }
  private async receive(client: WebSocket, raw: string): Promise<void> {
    let message: BrowserInbound;
    try { message = JSON.parse(raw) as BrowserInbound; } catch { return this.send(client, { type: "system.error", error: { code: "INVALID_JSON", message: "Invalid JSON message" } }); }
    if (message.type === "hello") { this.metrics.reconnects++; const replay = this.stream.replay(message.lastGenerationId, message.lastSequence); if (replay) { this.metrics.replays++; replay.forEach((event) => this.send(client, event)); } else { this.metrics.resyncs++; this.send(client, { type: "system.resyncRequired" }); } return this.send(client, this.snapshot()); }
    if (message.type === "codex.serverRequestResponse") { const pending = this.pending.get(message.requestKey); if (!pending) return this.send(client, { type: "rpc.error", requestId: message.requestKey, error: { code: "ALREADY_RESOLVED", message: "Request is stale or already resolved" } }); this.supervisor.broker.respond(pending.id, message.result, message.error); this.pending.delete(message.requestKey); this.attention.resolveRequest(message.requestKey); return this.broadcast(this.stream.append("attention.changed", { requestKey: message.requestKey, resolved: true, resolution: message.result ?? message.error, counts: this.attention.counts() })); }
    if (message.type !== "rpc.request") return;
    if (!allowedMethods.has(message.method)) return this.send(client, { type: "rpc.error", requestId: message.requestId, error: { code: "METHOD_NOT_ALLOWED", message: "Method is outside the PWA product boundary" } });
    if (message.method === "config/value/write" || message.method === "config/batchWrite") { const params = message.params as any; const keys = message.method === "config/value/write" ? [params?.keyPath] : (params?.edits ?? []).map((edit: any) => edit.keyPath); if (params?.filePath || keys.some((key: unknown) => typeof key !== "string" || !configKeyAllowlist.includes(key))) return this.send(client, { type: "rpc.error", requestId: message.requestId, error: { code: "CONFIG_KEY_NOT_ALLOWED", message: "Only documented Codex UI settings may be changed" } }); }
    this.metrics.rpcRequests++;
    try { const result = await this.supervisor.broker.request(message.method, message.params ?? {}); if (message.method === "thread/start" || message.method === "thread/fork") this.rememberThread((result as any)?.thread); this.send(client, { type: "rpc.response", requestId: message.requestId, result }); }
    catch (error) { this.metrics.rpcErrors++; this.send(client, { type: "rpc.error", requestId: message.requestId, error: { code: "CODEX_RPC_ERROR", message: error instanceof Error ? error.message : String(error) } }); }
  }
  private send(client: WebSocket, message: unknown): void { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message)); }
  private broadcast(message: unknown): void { for (const client of this.wss.clients) this.send(client, message); }
  private dispatch(item: import("../notifications/attention.js").AttentionItem): void { if (!this.dispatcher) return; const tokens = new Map<string, string>(); for (const token of this.sessionTokens.values()) tokens.set(accessTokenFingerprint(token), token); for (const token of tokens.values()) void this.dispatcher.dispatch(item, token); }
  private rememberThread(thread: any): void { if (thread && typeof thread.id === "string") this.observedThreads.set(thread.id, thread); }
}
