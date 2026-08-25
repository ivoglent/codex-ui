import { Injectable, signal } from "@angular/core";
import { SwPush } from "@angular/service-worker";
import { firstValueFrom, take } from "rxjs";

type HubConfig = { enabled: boolean; baseUrl: string | null; service: string };
type AttentionItem = { id: string; category: string; priority: string; method: string; threadId?: string; turnId?: string };

/** Browser-side, Gateway-authenticated Notification Hub integration. */
@Injectable({ providedIn: "root" })
export class NotificationHubService {
  readonly state = signal<"unavailable" | "ready" | "subscribed" | "error">("unavailable");
  readonly error = signal<string | null>(null);
  private config: HubConfig | null = null;
  private initialization?: Promise<void>;
  private readonly published = new Set<string>(this.readPublished());

  constructor(private readonly swPush: SwPush) {}

  initialize(): Promise<void> { return this.initialization ??= this.loadConfig(); }

  async enable(): Promise<void> {
    try {
      await this.initialize();
      if (!this.config?.enabled || !this.config.baseUrl) throw new Error("Notification Hub is not configured");
      if (!this.swPush.isEnabled) throw new Error("Web Push is unavailable in this browser");
      const publicKey = await this.fetchJson<{ applicationServerKey?: string }>("/api/v1/push/config");
      if (!publicKey.applicationServerKey) throw new Error("Notification Hub has no VAPID public key configured");
      await this.register(await this.swPush.requestSubscription({ serverPublicKey: publicKey.applicationServerKey }));
      this.state.set("subscribed");
    } catch (error) { this.error.set(asMessage(error)); this.state.set("error"); throw error; }
  }

  /** Re-register an existing subscription without prompting the user. */
  async refreshExisting(): Promise<void> {
    await this.initialize();
    await this.refreshConfiguredSubscription();
  }

  private async refreshConfiguredSubscription(): Promise<void> {
    if (!this.config?.enabled || !this.swPush.isEnabled || Notification.permission !== "granted") return;
    const subscription = await this.currentSubscription();
    if (!subscription) return;
    await this.register(subscription);
    this.state.set("subscribed");
  }

  async publishAttention(item: AttentionItem): Promise<void> {
    await this.initialize();
    if (!this.config?.enabled || !this.config.baseUrl || this.published.has(item.id)) return;
    try {
      await this.request("/api/v1/notifications/publish", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ service: this.config.service, title: titleFor(item), message: messageFor(item), clickAction: "/", context: {
          attentionId: item.id, category: item.category, priority: item.priority, method: item.method,
          ...(item.threadId ? { threadId: item.threadId } : {}), ...(item.turnId ? { turnId: item.turnId } : {}),
        } }),
      });
      this.published.add(item.id);
      this.persistPublished();
    } catch (error) { this.error.set(asMessage(error)); this.state.set("error"); }
  }

  private async loadConfig(): Promise<void> {
    try {
      const response = await fetch("/api/notification-hub/config", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(`Notification Hub configuration failed (${response.status})`);
      this.config = await response.json() as HubConfig;
      this.state.set(this.config.enabled ? "ready" : "unavailable");
      if (this.config.enabled) await this.refreshConfiguredSubscription();
    } catch (error) { this.error.set(asMessage(error)); this.state.set("error"); }
  }

  private async register(subscription: PushSubscription): Promise<void> {
    const json = subscription.toJSON(); const keys = json.keys;
    if (!json.endpoint || !keys?.p256dh || !keys.auth) throw new Error("Browser returned an incomplete PushSubscription");
    const platform = browserPlatform();
    await this.request("/api/v1/me/destinations/web-push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: json.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, service: this.config?.service, platform, displayName: `Codex Control (${platform})` }) });
  }
  private currentSubscription(): Promise<PushSubscription | null> { return firstValueFrom(this.swPush.subscription.pipe(take(1))); }
  private async fetchJson<T>(path: string): Promise<T> { return this.request(path).then(response => response.json() as Promise<T>); }
  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.config?.baseUrl) throw new Error("Notification Hub is not configured");
    const response = await fetch(new URL(path, this.config.baseUrl).toString(), { ...init, credentials: "include" });
    if (!response.ok) throw new Error(`Notification Hub request failed (${response.status})`);
    return response;
  }
  private readPublished(): string[] { try { return JSON.parse(localStorage.getItem("codex.notificationHub.published") ?? "[]"); } catch { return []; } }
  private persistPublished(): void { localStorage.setItem("codex.notificationHub.published", JSON.stringify([...this.published].slice(-500))); }
}

function browserPlatform(): string { const agent = navigator.userAgent; if (/Edg\//.test(agent)) return "EDGE"; if (/Firefox\//.test(agent)) return "FIREFOX"; if (/OPR\//.test(agent)) return "OPERA"; if (/Safari\//.test(agent) && !/Chrome\//.test(agent)) return "SAFARI"; return /Chrome\//.test(agent) ? "CHROME" : "UNKNOWN"; }
function titleFor(item: AttentionItem): string { if (item.category === "approval") return "Codex is asking for approval"; if (item.category === "input") return "Codex needs your input"; if (item.category === "completed") return "Codex finished a task"; if (item.category === "failed") return "Codex task failed"; return "Codex Control update"; }
function messageFor(item: AttentionItem): string { const where = item.threadId ? " in a Codex session" : ""; if (item.category === "approval") return `A Codex turn${where} requested approval.`; if (item.category === "input") return `A Codex turn${where} needs your input.`; if (item.category === "completed") return `A Codex turn${where} finished.`; if (item.category === "failed") return `A Codex turn${where} failed.`; return item.method; }
function asMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
