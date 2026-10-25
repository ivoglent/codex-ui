import type { AttentionItem } from "./attention.js";
import { sendWebPush, type WebPushConfig, WebPushSubscriptionStore } from "./web-push.js";

export interface DispatchOutcome { accepted: boolean; status: number; error?: string; }

/** Account telemetry and warnings stay in the in-app timeline; they are not device alerts. */
export function shouldDispatchWebPush(item: AttentionItem): boolean { return item.category === "approval" || item.category === "input" || item.category === "completed" || item.category === "failed"; }

/** Delivers attention directly to the PWA subscriptions owned by this backend. */
export class NotificationDispatcher {
  constructor(private readonly config: WebPushConfig, private readonly subscriptions: WebPushSubscriptionStore, private readonly appName = "Codex Control") {}

  async dispatch(item: AttentionItem): Promise<DispatchOutcome[]> {
    if (!this.config.enabled || !this.config.publicKey || !this.config.privateKey || !this.config.subject) return [];
    const payload = { title: titleFor(item, this.appName), message: messageFor(item, this.appName), clickAction: clickActionFor(item), id: item.id };
    return Promise.all(this.subscriptions.list().map(async (subscription) => {
      try {
        const result = await sendWebPush({ publicKey: this.config.publicKey!, privateKey: this.config.privateKey!, subject: this.config.subject! }, subscription, payload);
        if (result.status === 404 || result.status === 410) await this.subscriptions.remove(subscription.endpoint);
        return { accepted: result.status >= 200 && result.status < 300, status: result.status };
      } catch (error) { return { accepted: false, status: 0, error: error instanceof Error ? error.message : String(error) }; }
    }));
  }
}

function titleFor(item: AttentionItem, appName: string): string { if (item.category === "approval") return `${appName} approval needed`; if (item.category === "input") return `${appName} needs your input`; if (item.category === "completed") return `${appName} task completed`; if (item.category === "failed") return `${appName} task failed`; return `${appName} update`; }
function messageFor(item: AttentionItem, appName: string): string { const session = item.threadId ? `Session ${shortId(item.threadId)}` : `A ${appName} session`; if (item.category === "approval") return `${session} needs your approval. Open ${appName} to review.`; if (item.category === "input") return `${session} needs your input. Open ${appName} to respond.`; if (item.category === "completed") return `${session} completed successfully. Open ${appName} to review the final response.`; if (item.category === "failed") return `${session} failed. Open ${appName} to review the error.`; return item.method; }
function clickActionFor(item: AttentionItem): string { return item.threadId ? `/?threadId=${encodeURIComponent(item.threadId)}` : "/"; }
function shortId(value: string): string { return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value; }
