import type { IncomingMessage, ServerResponse } from "node:http";
import type { BrowserHub } from "../websocket/hub.js";

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

/** Explicit, same-origin recovery for sessions created by other app-server clients. */
export async function handleSessionsApi(request: IncomingMessage, response: ServerResponse, hub: BrowserHub, publicOrigin?: string): Promise<boolean> {
  if (request.url?.split("?", 1)[0] !== "/api/sessions/scan") return false;
  if (request.method !== "POST") {
    response.setHeader("allow", "POST");
    json(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    return true;
  }
  const origin = request.headers.origin;
  if (publicOrigin && origin && origin !== publicOrigin) {
    json(response, 403, { error: { code: "ORIGIN_NOT_ALLOWED", message: "Request origin is not allowed" } });
    return true;
  }
  try { json(response, 200, await hub.scanSessions()); }
  catch { json(response, 502, { error: { code: "SESSION_SCAN_FAILED", message: "Sessions could not be scanned" } }); }
  return true;
}
