import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ScheduleRecord, ScheduleStatus } from "@codex-control/shared";

const MAX_PROMPT_BYTES = 8 * 1024;
const MAX_ERROR_BYTES = 512;

export class ScheduleValidationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "ScheduleValidationError";
  }
}

export interface ScheduleRegistryOptions {
  persistencePath?: string;
  safeRoot?: string;
  now?: () => Date;
}

interface PersistedFile {
  version: 1;
  schedules: ScheduleRecord[];
}

export class ScheduleRegistry {
  private current: readonly ScheduleRecord[];
  private mutation: Promise<void> = Promise.resolve();

  private constructor(
    schedules: ScheduleRecord[],
    private readonly persistencePath: string,
    private readonly safeRoot: string,
    private readonly nowFn: () => Date = () => new Date()
  ) {
    this.current = Object.freeze([...schedules]);
  }

  static async load(options: ScheduleRegistryOptions = {}): Promise<ScheduleRegistry> {
    const persistencePath = options.persistencePath ?? defaultPersistencePath();
    const safeRoot = resolveSafeRoot(options.safeRoot);
    let records: ScheduleRecord[] = [];
    if (existsSync(persistencePath)) {
      let raw: string | undefined;
      try { raw = readFileSync(persistencePath, "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (raw !== undefined) {
        try {
          const parsed = JSON.parse(raw) as Partial<PersistedFile>;
          if (parsed.version !== 1 || !Array.isArray(parsed.schedules)) throw new Error("Unsupported schedule registry format");
          records = parsed.schedules.map((schedule) => normaliseRecord(schedule, safeRoot));
        } catch (error) {
          if (error instanceof ScheduleValidationError) throw error;
          throw new Error(`Invalid schedule registry JSON: ${persistencePath}`);
        }
      }
    }
    return new ScheduleRegistry(records, persistencePath, safeRoot, options.now);
  }

  get safeRootPath(): string { return this.safeRoot; }

  list(): readonly ScheduleRecord[] { return this.current; }

  get(id: string): ScheduleRecord | undefined { return this.current.find((schedule) => schedule.id === id); }

  byStatus(status: ScheduleStatus): ScheduleRecord[] { return this.current.filter((schedule) => schedule.status === status); }

  dueBy(now: Date): ScheduleRecord[] {
    const stamp = now.getTime();
    return this.current
      .filter((schedule) => schedule.status === "pending" && Date.parse(schedule.runAt) <= stamp)
      .sort((left, right) => Date.parse(left.runAt) - Date.parse(right.runAt));
  }

  create(input: unknown): Promise<ScheduleRecord> {
    const task = this.mutation.then(() => this.createExclusive(input));
    this.mutation = task.then(() => undefined, () => undefined);
    return task;
  }

  update(id: string, input: unknown): Promise<ScheduleRecord> {
    const task = this.mutation.then(() => this.updateExclusive(id, input));
    this.mutation = task.then(() => undefined, () => undefined);
    return task;
  }

  remove(id: string): Promise<ScheduleRecord | undefined> {
    const task = this.mutation.then(() => this.removeExclusive(id));
    this.mutation = task.then(() => undefined, () => undefined);
    return task;
  }

  replace(schedule: ScheduleRecord): Promise<ScheduleRecord> {
    const task = this.mutation.then(() => this.replaceExclusive(schedule));
    this.mutation = task.then(() => undefined, () => undefined);
    return task;
  }

  private async createExclusive(input: unknown): Promise<ScheduleRecord> {
    const fields = validateCreateInput(input, this.safeRoot, this.nowFn());
    const record: ScheduleRecord = {
      id: randomUUID(),
      cwd: fields.cwd,
      prompt: fields.prompt,
      modelKey: fields.modelKey,
      modelProvider: fields.modelProvider,
      runAt: fields.runAt,
      status: "pending",
      createdAt: new Date().toISOString()
    };
    this.current = Object.freeze([record, ...this.current]);
    await this.persist();
    return record;
  }

  private async updateExclusive(id: string, input: unknown): Promise<ScheduleRecord> {
    const existing = this.current.find((schedule) => schedule.id === id);
    if (!existing) throw new ScheduleValidationError(404, "SCHEDULE_NOT_FOUND", `Schedule '${id}' was not found`);
    if (existing.status !== "pending") throw new ScheduleValidationError(409, "SCHEDULE_NOT_EDITABLE", "Only pending schedules can be edited");
    const fields = validatePatchInput(input, this.safeRoot, this.nowFn());
    const updated: ScheduleRecord = {
      ...existing,
      prompt: fields.prompt ?? existing.prompt,
      modelKey: fields.modelKey === undefined ? existing.modelKey : fields.modelKey ?? undefined,
      modelProvider: fields.modelProvider === undefined ? existing.modelProvider : fields.modelProvider ?? undefined,
      runAt: fields.runAt ?? existing.runAt,
      cwd: fields.cwd ?? existing.cwd
    };
    this.current = Object.freeze(this.current.map((schedule) => (schedule.id === id ? updated : schedule)));
    await this.persist();
    return updated;
  }

  private async removeExclusive(id: string): Promise<ScheduleRecord | undefined> {
    const existing = this.current.find((schedule) => schedule.id === id);
    if (!existing) return undefined;
    this.current = Object.freeze(this.current.filter((schedule) => schedule.id !== id));
    await this.persist();
    return existing;
  }

  private async replaceExclusive(schedule: ScheduleRecord): Promise<ScheduleRecord> {
    const safe = normaliseRecord(schedule, this.safeRoot);
    const next = this.current.some((entry) => entry.id === safe.id)
      ? this.current.map((entry) => (entry.id === safe.id ? safe : entry))
      : [safe, ...this.current];
    this.current = Object.freeze(next);
    await this.persist();
    return safe;
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.persistencePath), { recursive: true });
    const tmp = `${this.persistencePath}.tmp`;
    const payload: PersistedFile = { version: 1, schedules: [...this.current] };
    await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await rename(tmp, this.persistencePath);
  }
}

export function validateCreateInput(input: unknown, safeRoot: string, now: Date): ValidatedCreate {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ScheduleValidationError(400, "INVALID_SCHEDULE_REQUEST", "Request body must be a schedule object");
  const body = input as Record<string, unknown>;
  const allowed = new Set(["cwd", "prompt", "modelKey", "modelProvider", "runAt"]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw new ScheduleValidationError(400, "INVALID_SCHEDULE_REQUEST", `Unexpected field: ${key}`);
  }
  const cwd = validateCwd(body.cwd, safeRoot);
  const prompt = validatePrompt(body.prompt);
  const modelKey = optionalString(body.modelKey, "modelKey", 120);
  const modelProvider = optionalString(body.modelProvider, "modelProvider", 120);
  if ((modelKey === undefined) !== (modelProvider === undefined)) throw new ScheduleValidationError(400, "MODEL_REQUIRED", "modelKey and modelProvider must be supplied together");
  const runAt = validateRunAt(body.runAt, now);
  return { cwd, prompt, modelKey, modelProvider, runAt };
}

export function validatePatchInput(input: unknown, safeRoot: string, now: Date): ValidatedPatch {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ScheduleValidationError(400, "INVALID_SCHEDULE_REQUEST", "Request body must be a schedule object");
  const body = input as Record<string, unknown>;
  const allowed = new Set(["cwd", "prompt", "modelKey", "modelProvider", "runAt"]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw new ScheduleValidationError(400, "INVALID_SCHEDULE_REQUEST", `Unexpected field: ${key}`);
  }
  const cwd = body.cwd === undefined ? undefined : validateCwd(body.cwd, safeRoot);
  const prompt = body.prompt === undefined ? undefined : validatePrompt(body.prompt);
  const modelKey = body.modelKey === undefined ? undefined : optionalString(body.modelKey, "modelKey", 120);
  const modelProvider = body.modelProvider === undefined ? undefined : optionalString(body.modelProvider, "modelProvider", 120);
  if ((modelKey === undefined) !== (modelProvider === undefined)) throw new ScheduleValidationError(400, "MODEL_REQUIRED", "modelKey and modelProvider must be supplied together");
  const runAt = body.runAt === undefined ? undefined : validateRunAt(body.runAt, now);
  return { cwd, prompt, modelKey, modelProvider, runAt };
}

interface ValidatedCreate { cwd: string; prompt: string; modelKey?: string; modelProvider?: string; runAt: string }
interface ValidatedPatch { cwd?: string; prompt?: string; modelKey?: string; modelProvider?: string; runAt?: string }

function validateCwd(value: unknown, safeRoot: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ScheduleValidationError(400, "INVALID_CWD", "cwd is required");
  if (!isAbsolute(value)) throw new ScheduleValidationError(400, "INVALID_CWD", "cwd must be an absolute path");
  const resolved = resolve(value);
  const inside = resolved === safeRoot || resolved.startsWith(`${safeRoot}${sep}`);
  if (!inside) throw new ScheduleValidationError(400, "INVALID_CWD", "cwd must be inside the configured projects root");
  let real: string;
  try { real = realpathSync(resolved); }
  catch { throw new ScheduleValidationError(400, "INVALID_CWD", "cwd does not exist"); }
  const realInside = real === safeRoot || real.startsWith(`${safeRoot}${sep}`);
  if (!realInside) throw new ScheduleValidationError(400, "INVALID_CWD", "cwd resolves outside the configured projects root");
  if (!statSync(real).isDirectory()) throw new ScheduleValidationError(400, "INVALID_CWD", "cwd must be a directory");
  if (relative(safeRoot, real).startsWith("..")) throw new ScheduleValidationError(400, "INVALID_CWD", "cwd is outside the configured projects root");
  return real;
}

function validatePrompt(value: unknown): string {
  if (typeof value !== "string") throw new ScheduleValidationError(400, "INVALID_PROMPT", "prompt is required");
  const trimmed = value.trim();
  if (!trimmed) throw new ScheduleValidationError(400, "INVALID_PROMPT", "prompt is required");
  if (Buffer.byteLength(trimmed, "utf8") > MAX_PROMPT_BYTES) throw new ScheduleValidationError(400, "INVALID_PROMPT", `prompt must be ${MAX_PROMPT_BYTES} bytes or fewer`);
  return trimmed;
}

function optionalString(value: unknown, field: string, max: number): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new ScheduleValidationError(400, "INVALID_FIELD", `${field} must be a string`);
  if (value.length > max) throw new ScheduleValidationError(400, "INVALID_FIELD", `${field} must be ${max} characters or fewer`);
  return value;
}

function validateRunAt(value: unknown, now: Date): string {
  if (typeof value !== "string" || !value.trim()) throw new ScheduleValidationError(400, "INVALID_RUN_AT", "runAt is required");
  const stamp = Date.parse(value);
  if (Number.isNaN(stamp)) throw new ScheduleValidationError(400, "INVALID_RUN_AT", "runAt must be an ISO 8601 instant");
  if (stamp <= now.getTime()) throw new ScheduleValidationError(400, "INVALID_RUN_AT", "runAt must be in the future");
  return new Date(stamp).toISOString();
}

function normaliseRecord(record: unknown, safeRoot: string): ScheduleRecord {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new ScheduleValidationError(500, "INVALID_RECORD", "Schedule record is invalid");
  const body = record as Record<string, unknown>;
  if (typeof body.id !== "string" || typeof body.cwd !== "string" || typeof body.prompt !== "string" || typeof body.runAt !== "string" || typeof body.status !== "string" || typeof body.createdAt !== "string") {
    throw new ScheduleValidationError(500, "INVALID_RECORD", "Schedule record is missing required fields");
  }
  return {
    id: body.id,
    cwd: ensureCwdInsideSafeRoot(body.cwd, safeRoot),
    prompt: body.prompt,
    modelKey: typeof body.modelKey === "string" ? body.modelKey : undefined,
    modelProvider: typeof body.modelProvider === "string" ? body.modelProvider : undefined,
    runAt: new Date(Date.parse(body.runAt)).toISOString(),
    status: normaliseStatus(body.status),
    createdAt: new Date(Date.parse(body.createdAt)).toISOString(),
    lastRunAt: typeof body.lastRunAt === "string" ? new Date(Date.parse(body.lastRunAt)).toISOString() : undefined,
    lastError: typeof body.lastError === "string" ? body.lastError.slice(0, MAX_ERROR_BYTES) : undefined,
    lastThreadId: typeof body.lastThreadId === "string" ? body.lastThreadId : undefined,
    lastTurnId: typeof body.lastTurnId === "string" ? body.lastTurnId : undefined
  };
}

function ensureCwdInsideSafeRoot(cwd: string, safeRoot: string): string {
  const resolved = resolve(cwd);
  const inside = resolved === safeRoot || resolved.startsWith(`${safeRoot}${sep}`);
  if (!inside) throw new ScheduleValidationError(500, "INVALID_RECORD", "Persisted schedule cwd is outside the configured projects root");
  return resolved;
}

function normaliseStatus(value: string): ScheduleStatus {
  if (value === "pending" || value === "running" || value === "done" || value === "failed" || value === "cancelled") return value;
  throw new ScheduleValidationError(500, "INVALID_RECORD", `Unknown schedule status: ${value}`);
}

function defaultPersistencePath(): string {
  const codexHome = process.env.CODEX_HOME ?? joinHome(".codex");
  return process.env.CODEX_UI_SCHEDULES_FILE ?? joinHome(`${codexHome}/codex-ui/schedules.json`);
}

function joinHome(suffix: string): string {
  const home = process.env.HOME ?? homedir();
  return suffix.startsWith("~/") ? `${home}/${suffix.slice(2)}` : suffix;
}

function resolveSafeRoot(safeRootOverride?: string): string {
  const fromEnv = safeRootOverride ?? process.env.PROJECTS_ROOT;
  if (fromEnv && fromEnv.trim()) {
    const resolved = resolve(fromEnv);
    if (!existsSync(resolved)) throw new Error(`Configured projects root does not exist: ${resolved}`);
    const real = realpathSync(resolved);
    if (!statSync(real).isDirectory()) throw new Error(`Configured projects root is not a directory: ${real}`);
    return real;
  }
  const configPath = process.env.PROJECTS_CONFIG ?? resolve("config/projects.yaml");
  if (!existsSync(configPath)) throw new Error("Schedule registry requires PROJECTS_ROOT or PROJECTS_CONFIG to be set");
  const parsed = parseYaml(readFileSync(configPath, "utf8")) as { discovery?: { roots?: string[] } } | null;
  const roots = parsed?.discovery?.roots;
  if (!roots || roots.length !== 1) throw new Error("Schedule registry requires exactly one discovery root in projects.yaml");
  const expanded = roots[0].replace(/^\${([A-Z_][A-Z0-9_]*)}/, (_, name) => process.env[name] ?? "");
  const resolved = resolve(expanded);
  const real = realpathSync(resolved);
  if (!statSync(real).isDirectory()) throw new Error(`Configured projects root is not a directory: ${real}`);
  return real;
}
