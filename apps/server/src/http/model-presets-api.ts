import type { IncomingMessage, ServerResponse } from "node:http";
import { discoverModelPresets } from "../config/model-presets.js";

export async function handleModelPresetsApi(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  if (request.url?.split("?", 1)[0] !== "/api/model-presets") return false;
  if (request.method !== "GET") {
    response.statusCode = 405;
    response.setHeader("allow", "GET");
    response.end(JSON.stringify({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }));
    return true;
  }
  try {
    response.end(JSON.stringify({ presets: await discoverModelPresets() }));
  } catch {
    response.statusCode = 500;
    response.end(JSON.stringify({ error: { code: "MODEL_PRESETS_UNAVAILABLE", message: "Model presets could not be read" } }));
  }
  return true;
}
