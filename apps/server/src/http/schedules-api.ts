import type { IncomingMessage, ServerResponse } from "node:http";
import type { ScheduleRecord } from "@codex-control/shared";
import { ScheduleRegistry, ScheduleValidationError, validateCreateInput, validatePatchInput } from "../config/schedules.js";

const MAX_BODY_BYTES = 16 * 1024;

export interface SchedulesApiOptions {
  registry: ScheduleRegistry;
  publicOrigin?: string;
  now?: () => Date;
  onChanged?: (schedule: ScheduleRecord) => void;
}

function parseUrl(request: IncomingMessage): { id?: string; action?: string } | null {
  const path = request.url?.split("?", 1)[0];
  if (!path || !path.startsWith("/api/schedules")) return null;
  const rest = path.slice("/api/schedules".length);
  if (rest === "" || rest === "/") return {};
  const segments = rest.split("/").filter(Boolean);
  if (segments.length === 1) return { id: segments[0] };
  if (segments.length === 2 && (segments[1] === "run" || segments[1] === "cancel")) return { id: segments[0], action: segments[1] };
  return { id: segments[0], action: segments.slice(1).join("/") };
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new ScheduleValidationError(413, "REQUEST_TOO_LARGE", "Schedule request is too large");
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ScheduleValidationError(400, "INVALID_JSON", "Request body must be valid JSON"); }
}

function ensureOrigin(request: IncomingMessage, response: ServerResponse, publicOrigin?: string): boolean {
  if (!publicOrigin) return true;
  const origin = request.headers.origin;
  if (origin && origin !== publicOrigin) {
    json(response, 403, { error: { code: "ORIGIN_NOT_ALLOWED", message: "Request origin is not allowed" } });
    return false;
  }
  return true;
}

function ensureContentType(request: IncomingMessage, response: ServerResponse): boolean {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    json(response, 415, { error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Content-Type must be application/json" } });
    return false;
  }
  return true;
}

export async function handleSchedulesApi(request: IncomingMessage, response: ServerResponse, options: SchedulesApiOptions): Promise<boolean> {
  const parts = parseUrl(request);
  if (!parts) return false;
  if (!ensureOrigin(request, response, options.publicOrigin)) return true;

  try {
    if (!parts.id) {
      if (request.method === "GET") {
        json(response, 200, { schedules: options.registry.list() });
        return true;
      }
      if (request.method !== "POST") {
        response.setHeader("allow", "GET, POST");
        json(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
        return true;
      }
      if (!ensureContentType(request, response)) return true;
      const body = await readJsonBody(request);
      const fields = validateCreateInput(body, options.registry.safeRootPath, options.now?.() ?? new Date());
      const schedule = await options.registry.create(fields);
      options.onChanged?.(schedule);
      json(response, 201, { schedule });
      return true;
    }

    if (parts.action === "run") {
      if (request.method !== "POST") {
        response.setHeader("allow", "POST");
        json(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
        return true;
      }
      const schedule = options.registry.get(parts.id);
      if (!schedule) {
        json(response, 404, { error: { code: "SCHEDULE_NOT_FOUND", message: `Schedule '${parts.id}' was not found` } });
        return true;
      }
      const updated: ScheduleRecord = { ...schedule, status: "pending", runAt: (options.now?.() ?? new Date()).toISOString() };
      const stored = await options.registry.replace(updated);
      options.onChanged?.(stored);
      json(response, 202, { schedule: stored });
      return true;
    }

    if (parts.action === "cancel") {
      if (request.method !== "POST") {
        response.setHeader("allow", "POST");
        json(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
        return true;
      }
      const schedule = options.registry.get(parts.id);
      if (!schedule) {
        json(response, 404, { error: { code: "SCHEDULE_NOT_FOUND", message: `Schedule '${parts.id}' was not found` } });
        return true;
      }
      if (schedule.status !== "pending") {
        json(response, 409, { error: { code: "SCHEDULE_NOT_CANCELLABLE", message: "Only pending schedules can be cancelled" } });
        return true;
      }
      const updated: ScheduleRecord = { ...schedule, status: "cancelled" };
      const stored = await options.registry.replace(updated);
      options.onChanged?.(stored);
      json(response, 200, { schedule: stored });
      return true;
    }

    if (parts.action) {
      json(response, 404, { error: { code: "NOT_FOUND", message: "Unknown schedule action" } });
      return true;
    }

    if (request.method === "GET") {
      const schedule = options.registry.get(parts.id);
      if (!schedule) {
        json(response, 404, { error: { code: "SCHEDULE_NOT_FOUND", message: `Schedule '${parts.id}' was not found` } });
        return true;
      }
      json(response, 200, { schedule });
      return true;
    }
    if (request.method === "PATCH") {
      if (!ensureContentType(request, response)) return true;
      const body = await readJsonBody(request);
      const fields = validatePatchInput(body, options.registry.safeRootPath, options.now?.() ?? new Date());
      const stored = await options.registry.update(parts.id, fields);
      options.onChanged?.(stored);
      json(response, 200, { schedule: stored });
      return true;
    }
    if (request.method === "DELETE") {
      const removed = await options.registry.remove(parts.id);
      if (!removed) {
        json(response, 404, { error: { code: "SCHEDULE_NOT_FOUND", message: `Schedule '${parts.id}' was not found` } });
        return true;
      }
      json(response, 200, { schedule: removed });
      return true;
    }
    response.setHeader("allow", "GET, PATCH, DELETE");
    json(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    return true;
  } catch (error) {
    if (error instanceof ScheduleValidationError) {
      json(response, error.status, { error: { code: error.code, message: error.message } });
      return true;
    }
    json(response, 500, { error: { code: "SCHEDULE_REQUEST_FAILED", message: "Schedule request failed" } });
    return true;
  }
}
