import { Injectable, computed, effect, inject, signal } from "@angular/core";
import type { ScheduleRecord, ScheduleStatus } from "./schedule.types";
import { ConnectionService } from "./connection.service";

export interface ScheduleError { code: string; message: string }

export interface ScheduleCreateInput { cwd: string; prompt: string; modelKey?: string; modelProvider?: string; cron: string }

@Injectable({ providedIn: "root" })
export class ScheduleStore {
  private readonly connection = inject(ConnectionService);
  private readonly recordsValue = signal<ScheduleRecord[]>([]);
  private readonly loadingValue = signal(false);
  private readonly errorValue = signal<ScheduleError | null>(null);
  private readonly seenSequences = new Set<number>();
  readonly records = this.recordsValue.asReadonly();
  readonly loading = this.loadingValue.asReadonly();
  readonly error = this.errorValue.asReadonly();

  readonly pending = computed(() =>
    this.recordsValue()
      .filter((record) => record.status === "pending")
      .sort((left, right) => {
        const la = left.nextRunAt ? Date.parse(left.nextRunAt) : Number.POSITIVE_INFINITY;
        const ra = right.nextRunAt ? Date.parse(right.nextRunAt) : Number.POSITIVE_INFINITY;
        return la - ra;
      })
  );
  readonly running = computed(() => this.recordsValue().filter((record) => record.status === "running"));
  readonly history = computed(() =>
    this.recordsValue()
      .filter((record) => record.status !== "pending" && record.status !== "running")
      .sort((left, right) => {
        const la = left.lastRunAt ? Date.parse(left.lastRunAt) : Date.parse(left.createdAt);
        const ra = right.lastRunAt ? Date.parse(right.lastRunAt) : Date.parse(right.createdAt);
        return ra - la;
      })
  );

  constructor() {
    effect(() => {
      const events = this.connection.events();
      for (const event of events) {
        if (event.type === "schedule.changed" && (event as any).schedule) {
          const sequence = Number(event.sequence ?? 0);
          if (sequence && this.seenSequences.has(sequence)) continue;
          if (sequence) this.seenSequences.add(sequence);
          this.upsert((event as any).schedule);
        }
      }
    });
  }

  byStatus(status: ScheduleStatus): ScheduleRecord[] { return this.recordsValue().filter((record) => record.status === status); }

  async refresh(): Promise<void> {
    this.loadingValue.set(true);
    try {
      const response = await fetch("/api/schedules");
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message ?? `Could not load schedules (${response.status})`);
      this.recordsValue.set(Array.isArray(body?.schedules) ? body.schedules : []);
      this.errorValue.set(null);
    } catch (error) {
      this.errorValue.set({ code: "LOAD_FAILED", message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.loadingValue.set(false);
    }
  }

  async create(input: ScheduleCreateInput): Promise<ScheduleRecord> {
    const response = await fetch("/api/schedules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message ?? `Could not create schedule (${response.status})`);
    this.upsert(body.schedule);
    return body.schedule;
  }

  async update(id: string, input: Partial<ScheduleCreateInput>): Promise<ScheduleRecord> {
    const response = await fetch(`/api/schedules/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message ?? `Could not update schedule (${response.status})`);
    this.upsert(body.schedule);
    return body.schedule;
  }

  async run(id: string): Promise<ScheduleRecord> {
    const response = await fetch(`/api/schedules/${encodeURIComponent(id)}/run`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message ?? `Could not run schedule (${response.status})`);
    this.upsert(body.schedule);
    return body.schedule;
  }

  async cancel(id: string): Promise<ScheduleRecord> {
    const response = await fetch(`/api/schedules/${encodeURIComponent(id)}/cancel`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message ?? `Could not cancel schedule (${response.status})`);
    this.upsert(body.schedule);
    return body.schedule;
  }

  async remove(id: string): Promise<void> {
    const response = await fetch(`/api/schedules/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error?.message ?? `Could not delete schedule (${response.status})`);
    }
    this.recordsValue.update((records) => records.filter((record) => record.id !== id));
  }

  applyEvent(schedule: ScheduleRecord): void { this.upsert(schedule); }
  setError(error: ScheduleError | null): void { this.errorValue.set(error); }

  private upsert(schedule: ScheduleRecord): void {
    this.recordsValue.update((records) => {
      const index = records.findIndex((record) => record.id === schedule.id);
      if (index === -1) return [schedule, ...records];
      const next = records.slice();
      next[index] = schedule;
      return next;
    });
  }
}
