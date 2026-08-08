export type ScheduleStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export interface ScheduleRecord {
  id: string;
  cwd: string;
  prompt: string;
  modelKey?: string;
  modelProvider?: string;
  runAt: string;
  status: ScheduleStatus;
  createdAt: string;
  lastRunAt?: string;
  lastError?: string;
  lastThreadId?: string;
  lastTurnId?: string;
}
