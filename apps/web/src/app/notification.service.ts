import { Injectable, signal } from "@angular/core";

type PushConfig = { enabled: boolean; applicationServerKey: string | null };

/** Registers this browser directly with the Codex UI backend for Web Push. */
@Injectable({ providedIn: "root" })
export class NotificationService {
  private brandTitle = "Codex Control";
  readonly state = signal<"unavailable" | "ready" | "enabling" | "subscribed" | "error">("unavailable");
  readonly error = signal<string | null>(null);
  private config: PushConfig | null = null;
  private initialization?: Promise<void>;

  initialize(): Promise<void> { return this.initialization ??= this.loadConfig(); }
  setBrandTitle(title: string): void { this.brandTitle = title; }

  async enable(): Promise<void> {
    try {
      await this.initialize();
      if (!this.config?.enabled || !this.config.applicationServerKey) throw new Error("Web Push is not configured");
      this.state.set("enabling"); this.error.set(null);
      const registration = await this.registration();
      await this.register(await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToUint8Array(this.config.applicationServerKey) }));
      this.state.set("subscribed");
    } catch (error) { this.error.set(asMessage(error)); this.state.set("error"); throw error; }
  }

  async refreshExisting(): Promise<void> { await this.initialize(); await this.refreshConfiguredSubscription(); }
  private async refreshConfiguredSubscription(): Promise<void> { if (!this.config?.enabled || Notification.permission !== "granted") return; const subscription = await (await this.registration()).pushManager.getSubscription(); if (!subscription) return; await this.register(subscription); this.state.set("subscribed"); }
  private async loadConfig(): Promise<void> {
    try {
      const response = await fetch("/api/notifications/config", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(`Web Push configuration failed (${response.status})`);
      this.config = await response.json() as PushConfig;
      this.state.set(this.config.enabled ? "ready" : "unavailable");
      if (this.config.enabled) await this.refreshConfiguredSubscription();
    } catch (error) { this.error.set(asMessage(error)); this.state.set("error"); }
  }
  private async register(subscription: PushSubscription): Promise<void> {
    const json = subscription.toJSON(); const keys = json.keys;
    if (!json.endpoint || !keys?.p256dh || !keys.auth) throw new Error("Browser returned an incomplete PushSubscription");
    await this.request("/api/notifications/subscriptions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: json.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, displayName: `${this.brandTitle} (${browserPlatform()})` }) });
  }
  private async registration(): Promise<ServiceWorkerRegistration> { if (window.isSecureContext === false || !("serviceWorker" in navigator)) throw new Error("Web Push requires a secure deployed PWA with service workers enabled"); return withTimeout(navigator.serviceWorker.ready, 10_000, "Codex service worker did not become ready. Reload the page and try again."); }
  private async request(path: string, init: RequestInit = {}): Promise<Response> { if (!this.config?.enabled) throw new Error("Web Push is not configured"); const response = await fetch(path, { ...init, credentials: "same-origin" }); if (!response.ok) throw new Error(`Web Push request failed (${response.status})`); return response; }
}

function browserPlatform(): string { const agent = navigator.userAgent; if (/Edg\//.test(agent)) return "EDGE"; if (/Firefox\//.test(agent)) return "FIREFOX"; if (/OPR\//.test(agent)) return "OPERA"; if (/Safari\//.test(agent) && !/Chrome\//.test(agent)) return "SAFARI"; return /Chrome\//.test(agent) ? "CHROME" : "UNKNOWN"; }
function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> { const padding = "=".repeat((4 - value.length % 4) % 4); const binary = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(binary, char => char.charCodeAt(0)); }
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> { return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs))]); }
function asMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
