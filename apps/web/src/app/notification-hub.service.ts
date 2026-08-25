import { Injectable, signal } from "@angular/core";

type HubConfig = { enabled: boolean; baseUrl: string | null; service: string };

/** Browser-side, Gateway-authenticated Notification Hub integration. */
@Injectable({ providedIn: "root" })
export class NotificationHubService {
  readonly state = signal<"unavailable" | "ready" | "enabling" | "subscribed" | "error">("unavailable");
  readonly error = signal<string | null>(null);
  private config: HubConfig | null = null;
  private initialization?: Promise<void>;

  initialize(): Promise<void> { return this.initialization ??= this.loadConfig(); }

  async enable(): Promise<void> {
    try {
      await this.initialize();
      if (!this.config?.enabled || !this.config.baseUrl) throw new Error("Notification Hub is not configured");
      this.state.set("enabling"); this.error.set(null);
      const publicKey = await this.fetchJson<{ applicationServerKey?: string }>("/api/v1/push/config");
      if (!publicKey.applicationServerKey) throw new Error("Notification Hub has no VAPID public key configured");
      const registration = await this.registration();
      await this.register(await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToUint8Array(publicKey.applicationServerKey) }));
      this.state.set("subscribed");
    } catch (error) { this.error.set(asMessage(error)); this.state.set("error"); throw error; }
  }

  /** Re-register an existing subscription without prompting the user. */
  async refreshExisting(): Promise<void> {
    await this.initialize();
    await this.refreshConfiguredSubscription();
  }

  private async refreshConfiguredSubscription(): Promise<void> {
    if (!this.config?.enabled || Notification.permission !== "granted") return;
    const subscription = await (await this.registration()).pushManager.getSubscription();
    if (!subscription) return;
    await this.register(subscription);
    this.state.set("subscribed");
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
  private async registration(): Promise<ServiceWorkerRegistration> {
    if (window.isSecureContext === false || !("serviceWorker" in navigator)) throw new Error("Web Push requires a secure deployed PWA with service workers enabled");
    return withTimeout(navigator.serviceWorker.ready, 10_000, "Codex service worker did not become ready. Reload the page and try again.");
  }
  private async fetchJson<T>(path: string): Promise<T> { return this.request(path).then(response => response.json() as Promise<T>); }
  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.config?.baseUrl) throw new Error("Notification Hub is not configured");
    const response = await fetch(new URL(path, this.config.baseUrl).toString(), { ...init, credentials: "include" });
    if (!response.ok) throw new Error(`Notification Hub request failed (${response.status})`);
    return response;
  }
}

function browserPlatform(): string { const agent = navigator.userAgent; if (/Edg\//.test(agent)) return "EDGE"; if (/Firefox\//.test(agent)) return "FIREFOX"; if (/OPR\//.test(agent)) return "OPERA"; if (/Safari\//.test(agent) && !/Chrome\//.test(agent)) return "SAFARI"; return /Chrome\//.test(agent) ? "CHROME" : "UNKNOWN"; }
function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> { const padding = "=".repeat((4 - value.length % 4) % 4); const binary = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(binary, char => char.charCodeAt(0)); }
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> { return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs))]); }
function asMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
