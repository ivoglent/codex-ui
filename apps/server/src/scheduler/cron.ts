const FIELD_RANGES = [
  { min: 0, max: 59, name: "minute" },
  { min: 0, max: 23, name: "hour" },
  { min: 1, max: 31, name: "day-of-month" },
  { min: 1, max: 12, name: "month" },
  { min: 0, max: 6, name: "day-of-week" }
] as const;

export class CronValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CronValidationError";
  }
}

export type CronField = number[];

export interface CronExpression {
  source: string;
  fields: [CronField, CronField, CronField, CronField, CronField];
}

export function parseCron(input: unknown): CronExpression {
  if (typeof input !== "string" || !input.trim()) throw new CronValidationError("CRON_EMPTY", "Cron expression is required");
  const source = input.trim().replace(/\s+/g, " ");
  const parts = source.split(" ");
  if (parts.length !== 5) throw new CronValidationError("CRON_FIELD_COUNT", "Cron expression must have 5 fields (minute hour day-of-month month day-of-week)");
  const fields = parts.map((part, index) => parseField(part, FIELD_RANGES[index]));
  return { source, fields: fields as CronExpression["fields"] };
}

function parseField(part: string, range: { min: number; max: number; name: string }): CronField {
  const values = new Set<number>();
  for (const piece of part.split(",")) {
    const trimmed = piece.trim();
    if (!trimmed) throw new CronValidationError("CRON_EMPTY_PIECE", `Empty piece in ${range.name}`);
    const [head, stepRaw] = trimmed.split("/");
    const step = stepRaw === undefined ? 1 : parseInt(stepRaw, 10);
    if (!Number.isFinite(step) || step <= 0 || step > range.max) throw new CronValidationError("CRON_INVALID_STEP", `Invalid step '${stepRaw}' in ${range.name}`);
    let lo: number;
    let hi: number;
    if (head === "*") {
      lo = range.min;
      hi = range.max;
    } else if (head.includes("-")) {
      const [loR, hiR] = head.split("-");
      lo = parseInt(loR, 10);
      hi = parseInt(hiR, 10);
    } else {
      const single = parseInt(head, 10);
      if (!Number.isFinite(single)) throw new CronValidationError("CRON_INVALID_NUMBER", `Invalid number '${head}' in ${range.name}`);
      lo = single;
      hi = stepRaw === undefined ? single : range.max;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new CronValidationError("CRON_INVALID_NUMBER", `Invalid range '${head}' in ${range.name}`);
    if (lo < range.min || hi > range.max || lo > hi) throw new CronValidationError("CRON_OUT_OF_RANGE", `'${head}' is out of range for ${range.name} (${range.min}-${range.max})`);
    for (let value = lo; value <= hi; value += step) values.add(value);
  }
  return [...values].sort((left, right) => left - right);
}

export function nextRunAt(expression: CronExpression, after: Date, horizonMs = 5 * 365 * 24 * 60 * 60 * 1_000): Date | null {
  const [minutes, hours, days, months, weekdays] = expression.fields;
  const cursor = new Date(after.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const deadline = after.getTime() + horizonMs;
  while (cursor.getTime() <= deadline) {
    if (matches(cursor, minutes, hours, days, months, weekdays)) return cursor;
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

function matches(date: Date, minutes: CronField, hours: CronField, days: CronField, months: CronField, weekdays: CronField): boolean {
  if (!minutes.includes(date.getMinutes())) return false;
  if (!hours.includes(date.getHours())) return false;
  if (!months.includes(date.getMonth() + 1)) return false;
  const dayMatches = days.includes(date.getDate());
  const weekdayMatches = weekdays.includes(date.getDay());
  if (days.every((value) => value === date.getDate()) && weekdays.every((value) => value === date.getDay())) return dayMatches && weekdayMatches;
  return dayMatches || weekdayMatches;
}

export function describeCron(expression: CronExpression): string {
  const [minute, hour, day, month, weekday] = expression.fields;
  if (minute.length === 1 && hour.length === 1 && day.length === 31 && month.length === 12 && weekday.length === 7) return `every minute`;
  if (minute.length === 1 && hour.length === 24 && day.length === 31 && month.length === 12 && weekday.length === 7) return `every hour at minute ${minute[0]}`;
  if (minute.length === 60 && hour.length === 24 && day.length === 31 && month.length === 12 && weekday.length === 7) return `every minute`;
  const parts: string[] = [];
  if (minute.length === 1) parts.push(`minute ${minute[0]}`);
  else if (minute.length < 60) parts.push(`minutes ${summariseField(minute)}`);
  if (hour.length === 24) parts.push("every hour");
  else if (hour.length === 1) parts.push(`hour ${hour[0]}`);
  else parts.push(`hours ${summariseField(hour)}`);
  if (month.length === 12) parts.push("every month");
  else if (month.length === 1) parts.push(`month ${month[0]}`);
  if (weekday.length === 7) parts.push("");
  else if (weekday.length === 5 && !weekday.includes(0) && !weekday.includes(6)) parts.push("weekdays");
  else parts.push(`weekdays ${summariseField(weekday)}`);
  return parts.filter(Boolean).join(", ");
}

function summariseField(values: number[]): string {
  if (values.length <= 3) return values.join(", ");
  return `${values[0]}-${values[values.length - 1]}`;
}
