export function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

/**
 * Pull the turn id out of an RPC result regardless of whether the codex
 * app-server wraps the response in `{ turn: { id } }` or returns the turn
 * object directly as `{ id, items, status, error }`. Without this, a wrapped
 * response leaves `localTurnIds` empty and the "Codex is working" indicator
 * never clears, blocking new messages until the page is reloaded.
 */
export function extractTurnId(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const body = result as Record<string, unknown>;
  const turn = body.turn as { id?: unknown } | undefined;
  if (turn && typeof turn.id === "string") return turn.id;
  if (typeof body.id === "string") return body.id;
  return undefined;
}
