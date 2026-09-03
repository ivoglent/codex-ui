import type { IncomingMessage, ServerResponse } from "node:http";
import { ProjectCreateError, type ProjectRegistry } from "../config/projects.js";

const MAX_BODY_BYTES = 4 * 1024;

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
    if (size > MAX_BODY_BYTES) throw new ProjectCreateError(400, "REQUEST_TOO_LARGE", "Project request is too large");
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ProjectCreateError(400, "INVALID_JSON", "Request body must be valid JSON"); }
}

export async function handleProjectsApi(
  request: IncomingMessage,
  response: ServerResponse,
  registry: ProjectRegistry,
  publicOrigin?: string,
  onChanged?: () => void
): Promise<boolean> {
  const path = request.url?.split("?", 1)[0];
  if (path !== "/api/projects") return false;

  if (request.method === "GET") {
    json(response, 200, { projects: registry.projects });
    return true;
  }
  if (request.method !== "POST") {
    response.setHeader("allow", "GET, POST");
    json(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    return true;
  }

  const origin = request.headers.origin;
  if (publicOrigin && origin && origin !== publicOrigin) {
    json(response, 403, { error: { code: "ORIGIN_NOT_ALLOWED", message: "Request origin is not allowed" } });
    return true;
  }
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    json(response, 415, { error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Content-Type must be application/json" } });
    return true;
  }

  try {
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "name")) {
      throw new ProjectCreateError(400, "INVALID_PROJECT_REQUEST", "Request body must contain only a project name");
    }
    const project = await registry.create((body as { name?: unknown }).name);
    onChanged?.();
    json(response, 201, { project });
  } catch (error) {
    if (error instanceof ProjectCreateError) json(response, error.status, { error: { code: error.code, message: error.message } });
    else json(response, 500, { error: { code: "PROJECT_CREATE_FAILED", message: "Project could not be created" } });
  }
  return true;
}
