import { computed, Injectable, signal } from "@angular/core";
import { createId } from "./id";
import { TimelineStore } from "./timeline.store";

export interface UiEvent { type: string; sequence?: number; generationId?: string; method?: string; params?: any; [key: string]: any }
@Injectable({ providedIn: "root" })
export class ConnectionService {
  readonly state = signal<"connecting" | "connected" | "disconnected">("connecting");
  readonly canSend = computed(() => this.state() === "connected");
  readonly snapshot = signal<any>(null); readonly events = signal<UiEvent[]>([]); readonly pending = signal<any[]>([]); readonly responses = signal<Record<string, any>>({});
  private socket?: WebSocket; private retry = 500; private generation?: string; private sequence = 0;
  private readonly clientId = localStorage.getItem("codex.clientId") ?? createId();
  constructor(private readonly timeline: TimelineStore) { localStorage.setItem("codex.clientId", this.clientId); this.connect(); addEventListener("online", () => this.connect()); addEventListener("offline", () => { this.state.set("disconnected"); this.socket?.close(); }); addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && this.socket?.readyState !== WebSocket.OPEN) this.connect(); }); }
  async rpc(method: string, params: unknown = {}): Promise<any> { const requestId = createId(); this.requireConnected(); this.send({ type: "rpc.request", requestId, method, params }); return new Promise((resolve, reject) => { const timeout = setTimeout(() => { clearInterval(poll); reject(new Error("Request timed out")); }, 60_000); const poll = setInterval(() => { const response = this.responses()[requestId]; if (!response) return; clearInterval(poll); clearTimeout(timeout); response.error ? reject(new Error(response.error.message)) : resolve(response.result); }, 30); }); }
  async createProject(name: string): Promise<any> {
    this.requireConnected();
    const response = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message ?? `Project creation failed (${response.status})`);
    this.mergeProject(body.project);
    return body.project;
  }
  async readModelPresets(): Promise<any[]> {
    const response = await fetch("/api/model-presets");
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message ?? `Model presets could not be read (${response.status})`);
    return Array.isArray(body?.presets) ? body.presets : [];
  }
  async forceReconnect(): Promise<void> {
    if (!navigator.onLine) { this.state.set("disconnected"); return; }
    const previous = this.socket;
    if (previous && previous.readyState !== WebSocket.CLOSED) previous.close();
    if (previous) { previous.onopen = null; previous.onmessage = null; previous.onclose = null; previous.onerror = null; }
    this.socket = undefined;
    this.retry = 500;
    this.connect();
  }
  resolve(requestKey: string, result: unknown): void { const request = this.pending().find((item) => item.requestKey === requestKey); this.pending.update((value) => value.filter((item) => item.requestKey !== requestKey)); try { this.send({ type: "codex.serverRequestResponse", requestKey, result }); } catch (error) { if (request) this.pending.update((value) => value.some((item) => item.requestKey === requestKey) ? value : [...value, request]); throw error; } }
  private connect(): void { if (!navigator.onLine) { this.state.set("disconnected"); return; } if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return; this.state.set("connecting"); const protocol = location.protocol === "https:" ? "wss:" : "ws:"; this.socket = new WebSocket(`${protocol}//${location.host}/ws`); this.socket.onopen = () => { this.state.set("connected"); this.retry = 500; this.send({ type: "hello", clientId: this.clientId, lastGenerationId: this.generation, lastSequence: this.sequence }); }; this.socket.onmessage = ({ data }) => this.accept(JSON.parse(data)); this.socket.onclose = () => { this.state.set("disconnected"); setTimeout(() => this.connect(), this.retry); this.retry = Math.min(15_000, this.retry * 2); }; }
  private accept(message: UiEvent): void { if (message.generationId) this.generation = message.generationId; if (message.sequence) this.sequence = Math.max(this.sequence, message.sequence); if (message.type === "system.snapshot") { this.snapshot.set(message); this.pending.set(message.pendingRequests ?? []); } if (message.type === "rpc.response" || message.type === "rpc.error") this.responses.update((value) => ({ ...value, [message.requestId]: message })); if (message.type === "codex.serverRequest") this.pending.update((value) => value.some((item) => item.requestKey === message.requestKey) ? value : [...value, message]); if (message.type === "attention.changed" && message.resolved) this.pending.update((value) => value.filter((item) => item.requestKey !== message.requestKey)); if (message.type === "codex.event") { this.events.update((value) => [...value.slice(-3999), message]); this.timeline.accept(message); this.notify(message); } }
  private notify(message: UiEvent): void { if (document.visibilityState === "visible" || Notification.permission !== "granted") return; if (["turn/completed", "error", "warning"].includes(message.method ?? "")) new Notification(message.method === "turn/completed" ? "Codex turn completed" : "Codex needs attention", { body: message.method, tag: `${message.generationId}:${message.sequence}` }); }
  private mergeProject(project: any): void {
    if (!project) return;
    const snapshot = this.snapshot();
    if (!snapshot) return;
    const projects = [...(snapshot.projects ?? []).filter((item: any) => item.id !== project.id), project];
    this.snapshot.set({ ...snapshot, projects });
  }
  private requireConnected(): void { if (this.state() !== "connected" || this.socket?.readyState !== WebSocket.OPEN) throw new Error("Backend is disconnected"); }
  private send(message: unknown): void { if (this.socket?.readyState !== WebSocket.OPEN) throw new Error("Backend is disconnected"); this.socket.send(JSON.stringify(message)); }
}
