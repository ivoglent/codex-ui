import { createHash } from "node:crypto";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from "node:https";
import { URL } from "node:url";
import type { AttentionCategory, AttentionItem } from "./attention.js";

const SEVERITY_BY_CATEGORY: Record<AttentionCategory, string> = { approval: "WARNING", input: "WARNING", completed: "INFO", failed: "CRITICAL", system: "INFO", account: "INFO" };

export interface NotificationDispatcherConfig { baseUrl: string; service: string; timeoutMs?: number; }
export interface DispatchOutcome { accepted: boolean; status: number; error?: string; }

/** Account telemetry and warnings stay in the in-app timeline; they are not device alerts. */
export function shouldDispatchWebPush(item: AttentionItem): boolean { return item.category === "approval" || item.category === "input" || item.category === "completed" || item.category === "failed"; }

/**
 * Sends attention through the Gateway with the opaque access_token captured
 * from a live, authenticated WebSocket session. The token is never parsed,
 * logged, persisted, or sent to a browser; Gateway validates it and supplies
 * Notification Hub with the trusted current-user identity.
 */
export class NotificationDispatcher {
  private readonly timeoutMs: number;
  constructor(private readonly config: NotificationDispatcherConfig, private readonly onOutcome?: (item: AttentionItem, outcome: DispatchOutcome) => void) { this.timeoutMs = config.timeoutMs ?? 5_000; }

  async dispatch(item: AttentionItem, accessToken: string): Promise<DispatchOutcome> {
    try {
      const outcome = await this.post(JSON.stringify({ service: this.config.service, title: titleFor(item), message: messageFor(item), clickAction: clickActionFor(item), context: { attentionId: item.id, category: item.category, severity: SEVERITY_BY_CATEGORY[item.category], priority: item.priority, method: item.method, ...(item.threadId ? { threadId: item.threadId } : {}), ...(item.turnId ? { turnId: item.turnId } : {}) } }), accessToken);
      this.onOutcome?.(item, outcome);
      if (!outcome.accepted) console.warn(`[notification-dispatcher] publish rejected item=${item.id} status=${outcome.status}`);
      return outcome;
    } catch (error) {
      const outcome = { accepted: false, status: 0, error: error instanceof Error ? error.message : String(error) };
      this.onOutcome?.(item, outcome);
      console.warn(`[notification-dispatcher] publish failed item=${item.id}: ${outcome.error}`);
      return outcome;
    }
  }

  private post(body: string, accessToken: string): Promise<DispatchOutcome> {
    return new Promise((resolve) => {
      const url = new URL("/api/v1/notifications/publish", this.config.baseUrl);
      const secure = url.protocol === "https:";
      const options: RequestOptions | HttpsRequestOptions = { method: "POST", hostname: url.hostname, port: url.port || (secure ? 443 : 80), path: url.pathname + url.search, headers: { accept: "application/json", "content-type": "application/json", "content-length": Buffer.byteLength(body), cookie: `access_token=${accessToken}` } };
      const request = (secure ? httpsRequest : httpRequest)(options, (response) => {
        response.resume();
        response.on("end", () => resolve({ accepted: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300, status: response.statusCode ?? 0 }));
      });
      request.setTimeout(this.timeoutMs, () => request.destroy(new Error(`Notification Hub request timed out after ${this.timeoutMs}ms`)));
      request.once("error", (error) => resolve({ accepted: false, status: 0, error: error.message }));
      request.end(body);
    });
  }
}

/** Returns an opaque JWT cookie value only when it is safe to forward. */
export function accessTokenFromCookie(header: string | undefined): string | null {
  if (!header || /[\r\n]/.test(header)) return null;
  const token = header?.match(/(?:^|;)\s*access_token=([^;\r\n]+)/)?.[1];
  return token?.trim() || null;
}
export function accessTokenFingerprint(accessToken: string): string { return createHash("sha256").update(accessToken).digest("hex"); }
function titleFor(item: AttentionItem): string { if (item.category === "approval") return "Codex approval needed"; if (item.category === "input") return "Codex needs your input"; if (item.category === "completed") return "Codex task completed"; if (item.category === "failed") return "Codex task failed"; return "Codex Control update"; }
function messageFor(item: AttentionItem): string { const session = item.threadId ? `Session ${shortId(item.threadId)}` : "A Codex session"; if (item.category === "approval") return `${session} needs your approval. Open Codex Control to review.`; if (item.category === "input") return `${session} needs your input. Open Codex Control to respond.`; if (item.category === "completed") return `${session} completed successfully. Open Codex Control to review the final response.`; if (item.category === "failed") return `${session} failed. Open Codex Control to review the error.`; return item.method; }
function clickActionFor(item: AttentionItem): string { return item.threadId ? `/?threadId=${encodeURIComponent(item.threadId)}` : "/"; }
function shortId(value: string): string { return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value; }
