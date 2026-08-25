import { computed, Injectable, signal } from "@angular/core";
import { createId } from "./id";
import { TimelineStore } from "./timeline.store";
import { NotificationHubService } from "./notification-hub.service";

export interface UiEvent { type: string; sequence?: number; generationId?: string; method?: string; params?: any; [key: string]: any }
@Injectable({ providedIn: "root" })
export class ConnectionService {
  readonly state = signal<"connecting" | "connected" | "disconnected">("connecting");
  readonly canSend = computed(() => this.state() === "connected");
  readonly authRequired = signal(false);
  readonly snapshot = signal<any>(null); readonly events = signal<UiEvent[]>([]); readonly pending = signal<any[]>([]); readonly responses = signal<Record<string, any>>({});
  private socket?: WebSocket; private retry = 500; private generation?: string; private sequence = 0;
  private authProbeTimer?: number;
  private authProbeInflight = false;
  private readonly clientId = localStorage.getItem("codex.clientId") ?? createId();
  constructor(private readonly timeline: TimelineStore, private readonly notificationHub?: NotificationHubService) {
    localStorage.setItem("codex.clientId", this.clientId);
    void this.notificationHub?.initialize();
    this.connect();
    addEventListener("online", () => { this.authRequired.set(false); this.connect(); });
    addEventListener("offline", () => { this.state.set("disconnected"); this.socket?.close(); });
    addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        if (this.socket?.readyState !== WebSocket.OPEN) {
          this.authRequired.set(false);
          this.connect();
        }
      }
    });
    // Expose the service on window only when the URL opts in. e2e tests
    // append `?codexTest=1` to simulate gateway-level failures without
    // relying on the OS offline event, which Chromium does not honour when
    // dispatched manually. Production traffic never carries the flag.
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("codexTest") === "1") (window as unknown as { __codexConnection?: ConnectionService }).__codexConnection = this;
    }
  }
  async rpc(method: string, params: unknown = {}): Promise<any> { const requestId = createId(); this.requireConnected(); this.send({ type: "rpc.request", requestId, method, params }); return new Promise((resolve, reject) => { const timeout = setTimeout(() => { clearInterval(poll); reject(new Error("Request timed out")); }, 60_000); const poll = setInterval(() => { const response = this.responses()[requestId]; if (!response) return; clearInterval(poll); clearTimeout(timeout); response.error ? reject(new Error(response.error.message)) : resolve(response.result); }, 30); }); }
  async createProject(name: string): Promise<any> {
    this.requireConnected();
    const response = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message ?? `Project creation failed (${response.status})`);
    this.mergeProject(body.project);
    return body.project;
  }
  async scanSessions(): Promise<any[]> {
    this.requireConnected();
    const response = await fetch("/api/sessions/scan", { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message ?? `Session scan failed (${response.status})`);
    return Array.isArray(body?.data) ? body.data : [];
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
    this.authRequired.set(false);
    this.connect();
  }
  /**
   * Probe the gateway to distinguish between a transient network failure and
   * an expired session. The PWA sits behind an HTTPS gateway that performs
   * SSO, so a 401 or 302 redirect to a login URL means the cookie/session is
   * gone and the user has to re-authenticate before the chat can recover.
 * Returns true when the probe confirms auth is required.
 */
  async probeAuth(): Promise<boolean> {
    if (this.authRequired()) return true;
    if (typeof fetch !== "function") return false;
    if (this.authProbeInflight) return false;
    this.authProbeInflight = true;
    try {
      const response = await fetch("/api/version", { method: "GET", redirect: "manual", cache: "no-store", credentials: "same-origin" });
      // `redirect: "manual"` exposes 3xx as an opaque response: status 0 with type "opaqueredirect".
      if (response.type === "opaqueredirect") { this.authRequired.set(true); return true; }
      if (response.status === 401 || response.status === 403) { this.authRequired.set(true); return true; }
      return false;
    } catch {
      // Network errors are transient and must not be reported as auth failures.
      return false;
    } finally { this.authProbeInflight = false; }
  }
  /**
   * Schedule an auth probe a few seconds after the WebSocket reports a
 * disconnect. Triggering immediately on every close would mis-classify short
 * network blips as expired sessions; deferring gives the gateway time to
 * serve a healthy response on the next attempt and avoids noisy popups.
 */
  private scheduleAuthProbe(): void {
    if (this.authRequired() || this.authProbeTimer !== undefined) return;
    this.authProbeTimer = window.setTimeout(() => {
      this.authProbeTimer = undefined;
      void this.probeAuth();
    }, 4_000);
  }
  resolve(requestKey: string, result: unknown): void { const request = this.pending().find((item) => item.requestKey === requestKey); this.pending.update((value) => value.filter((item) => item.requestKey !== requestKey)); try { this.send({ type: "codex.serverRequestResponse", requestKey, result }); } catch (error) { if (request) this.pending.update((value) => value.some((item) => item.requestKey === requestKey) ? value : [...value, request]); throw error; } }
  private connect(): void {
    if (!navigator.onLine) { this.state.set("disconnected"); return; }
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.state.set("connecting");
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    this.socket = new WebSocket(`${protocol}//${location.host}/ws`);
    this.socket.onopen = () => {
      this.state.set("connected");
      this.retry = 500;
      if (this.authProbeTimer !== undefined) { clearTimeout(this.authProbeTimer); this.authProbeTimer = undefined; }
      this.authRequired.set(false);
      this.send({ type: "hello", clientId: this.clientId, lastGenerationId: this.generation, lastSequence: this.sequence });
    };
    this.socket.onmessage = ({ data }) => this.accept(JSON.parse(data));
    this.socket.onclose = () => {
      this.state.set("disconnected");
      // Defer auth probing until a real handshake has succeeded at least once,
      // otherwise the very first WS upgrade can race the gateway's auth check.
      if (this.generation) this.scheduleAuthProbe();
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(15_000, this.retry * 2);
    };
  }
  private accept(message: UiEvent): void { if (message.generationId) this.generation = message.generationId; if (message.sequence) this.sequence = Math.max(this.sequence, message.sequence); if (message.type === "system.snapshot") { this.snapshot.set(message); this.pending.set(message.pendingRequests ?? []); } if (message.type === "rpc.response" || message.type === "rpc.error") this.responses.update((value) => ({ ...value, [message.requestId]: message })); if (message.type === "codex.serverRequest") this.pending.update((value) => value.some((item) => item.requestKey === message.requestKey) ? value : [...value, message]); if (message.type === "attention.changed") { if (message.resolved) this.pending.update((value) => value.filter((item) => item.requestKey !== message.requestKey)); if (message.item) void this.notificationHub?.publishAttention(message.item); } if (message.type === "codex.event") { this.events.update((value) => [...value.slice(-3999), message]); this.timeline.accept(message); this.notify(message); } }
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
