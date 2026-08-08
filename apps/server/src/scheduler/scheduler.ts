import { EventEmitter } from "node:events";
import type { ScheduleRecord } from "@codex-control/shared";
import type { ScheduleRegistry } from "../config/schedules.js";
import type { AppServerSupervisor } from "../codex/supervisor.js";
import { parseCron, nextRunAt } from "./cron.js";

const DEFAULT_TICK_MS = 5_000;
const DEFAULT_MAX_CONCURRENCY = 4;
const DEFAULT_MISS_WINDOW_MS = 5 * 60_000;
const MAX_ERROR_LENGTH = 512;

export interface SchedulerOptions {
  registry: ScheduleRegistry;
  supervisor: Pick<AppServerSupervisor, "status" | "broker" | "on" | "off">;
  broadcast: (schedule: ScheduleRecord) => void;
  tickMs?: number;
  missWindowMs?: number;
  maxConcurrency?: number;
  now?: () => Date;
}

export interface SchedulerEvents {
  changed: [ScheduleRecord];
  ran: [ScheduleRecord];
  failed: [ScheduleRecord, Error];
}

export class Scheduler extends EventEmitter<SchedulerEvents> {
  private readonly registry: ScheduleRegistry;
  private readonly supervisor: SchedulerOptions["supervisor"];
  private readonly broadcast: SchedulerOptions["broadcast"];
  private readonly tickMs: number;
  private readonly missWindowMs: number;
  private readonly maxConcurrency: number;
  private readonly now: () => Date;
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly perCwdRunning = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private started = false;
  private statusListener?: (status: { state: string }) => void;
  private appServerReady = false;

  constructor(options: SchedulerOptions) {
    super();
    this.registry = options.registry;
    this.supervisor = options.supervisor;
    this.broadcast = options.broadcast;
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS;
    this.missWindowMs = options.missWindowMs ?? DEFAULT_MISS_WINDOW_MS;
    this.maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.appServerReady = this.supervisor.status.state === "READY";
    this.statusListener = (status) => { this.appServerReady = status.state === "READY"; if (this.appServerReady) void this.tick(); };
    this.supervisor.on("status", this.statusListener);
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    void this.tick();
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.statusListener) { this.supervisor.off("status", this.statusListener); this.statusListener = undefined; }
    await Promise.allSettled([...this.inflight.values()]);
  }

  async tick(): Promise<void> {
    if (this.running || !this.started) return;
    this.running = true;
    try {
      if (!this.appServerReady) return;
      if (this.inflight.size >= this.maxConcurrency) return;
      const due = this.registry.dueBy(this.now()).filter((schedule) => !this.inflight.has(schedule.id));
      for (const schedule of due) {
        if (this.inflight.size >= this.maxConcurrency) break;
        if ((this.perCwdRunning.get(schedule.cwd) ?? 0) > 0) continue;
        this.dispatch(schedule).catch((error) => this.fail(schedule, error));
      }
    } finally {
      this.running = false;
    }
  }

  private dispatch(schedule: ScheduleRecord): Promise<void> {
    const inflight = this.run(schedule).finally(() => {
      this.inflight.delete(schedule.id);
      this.perCwdRunning.set(schedule.cwd, Math.max(0, (this.perCwdRunning.get(schedule.cwd) ?? 1) - 1));
    });
    this.inflight.set(schedule.id, inflight);
    this.perCwdRunning.set(schedule.cwd, (this.perCwdRunning.get(schedule.cwd) ?? 0) + 1);
    return inflight;
  }

  private async run(schedule: ScheduleRecord): Promise<void> {
    const startedAt = this.now().toISOString();
    const running: ScheduleRecord = { ...schedule, status: "running", lastRunAt: startedAt, lastError: undefined };
    const stored = await this.registry.replace(running);
    this.notify(stored);
    this.emit("ran", stored);

    let threadId: string | undefined;
    let turnId: string | undefined;
    try {
      const broker = this.supervisor.broker;
      const start = await broker.request<unknown>("thread/start", {
        cwd: stored.cwd,
        ...(stored.modelKey && stored.modelProvider ? { model: stored.modelKey, modelProvider: stored.modelProvider } : {})
      });
      threadId = extractThreadId(start);
      if (!threadId) throw new Error("app-server did not return a thread id");

      const turn = await broker.request<unknown>("turn/start", {
        threadId,
        input: [{ type: "text", text: stored.prompt }]
      });
      turnId = extractTurnId(turn);

      const advanced = advanceNextRun(stored, this.now());
      if (!advanced) {
        const failed: ScheduleRecord = { ...stored, status: "failed", lastError: "cron cannot produce the next run" };
        const finalRecord = await this.registry.replace(failed);
        this.notify(finalRecord);
        return;
      }
      const done: ScheduleRecord = { ...stored, ...advanced, lastThreadId: threadId, lastTurnId: turnId };
      const finalRecord = await this.registry.replace(done);
      this.notify(finalRecord);
    } catch (error) {
      this.fail(stored, error);
    }
  }

  private async fail(schedule: ScheduleRecord, error: unknown): Promise<void> {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_LENGTH);
    const advanced = advanceNextRun(schedule, this.now());
    const failed: ScheduleRecord = advanced
      ? { ...schedule, ...advanced, lastError: message }
      : { ...schedule, status: "failed", lastError: message };
    const stored = await this.registry.replace(failed);
    this.notify(stored);
    this.emit("failed", stored, error instanceof Error ? error : new Error(message));
  }

  private async notify(schedule: ScheduleRecord): Promise<void> {
    this.emit("changed", schedule);
    this.broadcast(schedule);
  }
}

function advanceNextRun(schedule: ScheduleRecord, now: Date): { status: "pending"; nextRunAt: string } | null {
  if (schedule.status === "cancelled") return null;
  const expression = parseCron(schedule.cron);
  const next = nextRunAt(expression, now);
  if (!next) return null;
  return { status: "pending", nextRunAt: next.toISOString() };
}

function extractThreadId(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const body = result as Record<string, unknown>;
  const thread = body.thread as { id?: string } | undefined;
  if (thread?.id) return thread.id;
  const fallback = body.threadId;
  return typeof fallback === "string" ? fallback : undefined;
}

function extractTurnId(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const body = result as Record<string, unknown>;
  const turn = body.turn as { id?: string } | undefined;
  if (turn?.id) return turn.id;
  const fallback = body.turnId;
  return typeof fallback === "string" ? fallback : undefined;
}
