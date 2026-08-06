import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { BrowserInbound } from "@codex-control/shared";
import type { AppServerSupervisor } from "../codex/supervisor.js";
import type { ProjectRegistry } from "../config/projects.js";
import { EventStream } from "./event-stream.js";
import { AttentionCoordinator } from "../notifications/attention.js";
import { Metrics } from "../observability/metrics.js";

const allowedMethods = new Set([
  "thread/start", "thread/resume", "thread/fork", "thread/read", "thread/list", "thread/turns/list", "thread/items/list", "thread/name/set", "thread/goal/set", "thread/goal/get", "thread/goal/clear", "thread/metadata/update", "thread/archive", "thread/unarchive", "thread/delete", "thread/unsubscribe", "thread/compact/start",
  "turn/start", "turn/steer", "turn/interrupt", "review/start", "model/list", "modelProvider/capabilities/read", "permissionProfile/list", "collaborationMode/list", "experimentalFeature/list", "experimentalFeature/enablement/set", "skills/list", "hooks/list", "mcpServerStatus/list", "mcpServer/oauth/login", "config/mcpServer/reload", "app/installed", "app/list", "app/read", "account/read", "account/rateLimits/read", "account/usage/read", "account/workspaceMessages/read", "config/read", "config/value/write", "config/batchWrite"
]);
const configKeyAllowlist = ["model", "model_reasoning_effort", "model_reasoning_summary", "personality", "approval_policy", "sandbox_mode", "features.apps", "features.plugins"];

export class BrowserHub {
  private readonly wss: WebSocketServer; private readonly stream: EventStream; private readonly pending = new Map<string, { id: number | string; method: string; params: unknown }>(); private readonly attention = new AttentionCoordinator();
  constructor(server: Server, private readonly supervisor: AppServerSupervisor, private readonly projects: ProjectRegistry, readonly metrics = new Metrics(), origin?: string, capacity = 10_000) {
    this.stream = new EventStream(capacity); this.wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
    server.on("upgrade", (request, socket, head) => {
      if (request.url !== "/ws" || (origin && request.headers.origin !== origin)) return socket.destroy();
      this.wss.handleUpgrade(request, socket, head, (client) => this.wss.emit("connection", client, request));
    });
    this.wss.on("connection", (client) => { this.metrics.clients++; client.once("close", () => this.metrics.clients--); client.on("message", (data) => void this.receive(client, data.toString())); });
    supervisor.on("notification", (method, params) => {
      this.metrics.notifications++;
      if (method === "serverRequest/resolved") {
        const requestId = (params as any)?.requestId;
        const resolved = [...this.pending].find(([, value]) => String(value.id) === String(requestId));
        if (resolved) {
          this.pending.delete(resolved[0]); this.attention.resolveRequest(resolved[0]);
          this.broadcast(this.stream.append("attention.changed", { requestKey: resolved[0], resolved: true, counts: this.attention.counts() }));
        }
      }
      const item = this.attention.add(method, params); this.broadcast(this.stream.append("codex.event", { method, params }));
      if (item) this.broadcast(this.stream.append("attention.changed", { item, counts: this.attention.counts() }));
    });
    supervisor.on("serverRequest", (id, method, params) => { const requestKey = randomUUID(); this.pending.set(requestKey, { id, method, params }); const item = this.attention.add(method, params, requestKey); this.broadcast(this.stream.append("codex.serverRequest", { requestKey, method, params, expiresAt: null })); if (item) this.broadcast(this.stream.append("attention.changed", { item, counts: this.attention.counts() })); });
    supervisor.on("status", (status) => this.broadcast(this.stream.append("system.status", { status })));
  }
  close(): void { this.wss.close(); }
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
    try { const result = await this.supervisor.broker.request(message.method, message.params ?? {}); this.send(client, { type: "rpc.response", requestId: message.requestId, result }); }
    catch (error) { this.metrics.rpcErrors++; this.send(client, { type: "rpc.error", requestId: message.requestId, error: { code: "CODEX_RPC_ERROR", message: error instanceof Error ? error.message : String(error) } }); }
  }
  private send(client: WebSocket, message: unknown): void { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message)); }
  private broadcast(message: unknown): void { for (const client of this.wss.clients) this.send(client, message); }
}
