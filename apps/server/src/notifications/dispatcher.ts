import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from "node:https";
import { URL } from "node:url";
import { AttentionCoordinator, type AttentionCategory, type AttentionItem } from "./attention.js";

/**
 * Severity hint sent to Notification Hub. The Hub uses its connector policy
 * to decide whether each destination receives the event; we map the Codex
 * attention category to the Hub's `info|warning|critical` scale.
 */
const SEVERITY_BY_CATEGORY: Record<AttentionCategory, string> = {
  approval: "warning",
  input: "warning",
  completed: "info",
  failed: "critical",
  system: "info",
  account: "info",
};

/**
 * Stable Codex-style type names. Notification Hub's policy is keyed on the
 * `(source, type, category)` tuple, so we keep these stable across releases.
 */
const TYPE_BY_CATEGORY: Record<AttentionCategory, string> = {
  approval: "codex.attention.approval",
  input: "codex.attention.input",
  completed: "codex.attention.turn_completed",
  failed: "codex.attention.turn_failed",
  system: "codex.attention.system",
  account: "codex.attention.account",
};

export interface NotificationDispatcherConfig {
  /** Origin of the Notification Hub (e.g. `https://notify.codecuatui.com`). */
  baseUrl: string;
  /** Bearer token for the Codex Control connector. */
  token: string;
  /** Logical service name registered against the Hub. */
  service?: string;
  /** Optional source label passed in the request body for log correlation. */
  source?: string;
  /** Per-request timeout in milliseconds. Defaults to 5000. */
  timeoutMs?: number;
}

export interface DispatchOutcome {
  /** True when the Hub accepted the event (HTTP 2xx). */
  accepted: boolean;
  /** HTTP status returned by the Hub, or `0` when the request failed locally. */
  status: number;
  /** Event id returned by the Hub when accepted. */
  eventId?: string;
  /** Error message when the Hub could not be reached. */
  error?: string;
}

/**
 * Bridge between the WebSocket {@link AttentionCoordinator} and the
 * Notification Hub ingestion API. When {@link attach} is called, every new
 * attention item is translated to an event and POSTed to
 * {@code POST {baseUrl}/api/v1/events}.
 *
 * The dispatcher is intentionally fire-and-forget so a slow or unreachable Hub
 * never blocks the WebSocket loop. Errors are logged via `console.warn` and
 * surfaced through the optional {@link onOutcome} callback for tests.
 */
export class NotificationDispatcher {
  private readonly config: NotificationDispatcherConfig;
  private readonly timeoutMs: number;
  private readonly onOutcome?: (item: AttentionItem, outcome: DispatchOutcome) => void;
  /** Most recent dedupKey per item id so re-emitted items do not double-post. */
  private readonly seen = new Map<string, string>();

  constructor(config: NotificationDispatcherConfig, options: { onOutcome?: (item: AttentionItem, outcome: DispatchOutcome) => void } = {}) {
    if (!config.baseUrl) throw new Error("NotificationDispatcher requires baseUrl");
    if (!config.token) throw new Error("NotificationDispatcher requires token");
    this.config = config;
    this.timeoutMs = config.timeoutMs ?? 5000;
    this.onOutcome = options.onOutcome;
  }

  /** Subscribe to a coordinator so every attention item is forwarded. */
  attach(coordinator: AttentionCoordinator): void {
    coordinator.onItem((item) => {
      void this.dispatch(item);
    });
  }

  /** Translate an attention item to a Hub event and POST it. */
  async dispatch(item: AttentionItem): Promise<DispatchOutcome> {
    const dedupKey = `codex-control:${item.id}`;
    const previous = this.seen.get(item.id);
    if (previous === dedupKey) {
      return { accepted: true, status: 200, eventId: previous };
    }
    this.seen.set(item.id, dedupKey);

    const body = JSON.stringify({
      source: this.config.source ?? "codex-control",
      type: TYPE_BY_CATEGORY[item.category],
      category: item.category,
      severityHint: SEVERITY_BY_CATEGORY[item.category],
      title: titleFor(item),
      message: messageFor(item),
      dedupKey,
      attributes: {
        threadId: item.threadId ?? null,
        turnId: item.turnId ?? null,
        priority: item.priority,
        method: item.method,
        service: this.config.service ?? "codex-control",
      },
      occurredAt: item.createdAt,
    });

    try {
      const outcome = await this.post(body);
      this.onOutcome?.(item, outcome);
      if (!outcome.accepted) {
        console.warn(
          `[notification-dispatcher] hub rejected ${item.category} item ${item.id}: status=${outcome.status} error=${outcome.error ?? "(none)"}`,
        );
      }
      return outcome;
    } catch (error) {
      const outcome: DispatchOutcome = {
        accepted: false,
        status: 0,
        error: error instanceof Error ? error.message : String(error),
      };
      this.onOutcome?.(item, outcome);
      console.warn(`[notification-dispatcher] failed to dispatch ${item.category} item ${item.id}:`, outcome.error);
      return outcome;
    }
  }

  private post(body: string): Promise<DispatchOutcome> {
    return new Promise<DispatchOutcome>((resolve) => {
      const url = new URL("/api/v1/events", this.config.baseUrl);
      const isHttps = url.protocol === "https:";
      const baseOptions = {
        method: "POST",
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.token}`,
          accept: "application/json",
          "content-length": Buffer.byteLength(body),
        },
      };
      const options: RequestOptions | HttpsRequestOptions = baseOptions;
      const client = isHttps ? httpsRequest(options, (res) => collect(res, resolve)) : httpRequest(options, (res) => collect(res, resolve));
      client.setTimeout(this.timeoutMs, () => {
        client.destroy(new Error(`Notification Hub request timed out after ${this.timeoutMs}ms`));
      });
      client.once("error", (error) => {
        resolve({ accepted: false, status: 0, error: error.message });
      });
      client.end(body);
    });
  }

  /** Read config from environment variables. Returns `null` when the Hub is disabled. */
  static fromEnv(source?: string): NotificationDispatcher | null {
    const baseUrl = process.env.NOTIFICATION_HUB_URL?.trim();
    const token = process.env.NOTIFICATION_HUB_TOKEN?.trim();
    if (!baseUrl || !token) return null;
    return new NotificationDispatcher({
      baseUrl,
      token,
      service: process.env.NOTIFICATION_HUB_SERVICE?.trim() || "codex-control",
      source,
      timeoutMs: Number(process.env.NOTIFICATION_HUB_TIMEOUT_MS ?? 5000) || 5000,
    });
  }
}

function collect(
  res: import("node:http").IncomingMessage,
  resolve: (outcome: DispatchOutcome) => void,
): void {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    let eventId: string | undefined;
    let error: string | undefined;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { eventId?: string; error?: { message?: string } | string };
        eventId = parsed.eventId;
        if (parsed.error) error = typeof parsed.error === "string" ? parsed.error : parsed.error.message;
      } catch {
        error = `non-JSON response (${raw.slice(0, 120)})`;
      }
    }
    const status = res.statusCode ?? 0;
    resolve({ accepted: status >= 200 && status < 300, status, eventId, error });
  });
  res.on("error", (error) => {
    resolve({ accepted: false, status: res.statusCode ?? 0, error: error.message });
  });
}

function titleFor(item: AttentionItem): string {
  switch (item.category) {
    case "approval":
      return "Codex is asking for approval";
    case "input":
      return "Codex needs your input";
    case "completed":
      return "Codex finished a task";
    case "failed":
      return "Codex task failed";
    case "system":
      return "Codex Control update";
    case "account":
      return "Codex Control account update";
    default:
      return "Codex Control update";
  }
}

function messageFor(item: AttentionItem): string {
  const where = item.threadId ? ` in thread ${item.threadId}` : "";
  switch (item.category) {
    case "approval":
      return `A Codex turn${where} requested approval.`;
    case "input":
      return `A Codex turn${where} is asking for your input.`;
    case "completed":
      return `A Codex turn${where} finished.`;
    case "failed":
      return `A Codex turn${where} failed.`;
    case "system":
      return item.method;
    case "account":
      return item.method;
    default:
      return item.method;
  }
}
