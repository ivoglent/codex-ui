import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const cwd = mkdtempSync(join(tmpdir(), "codex-control-smoke-"));
const child = spawn("codex", ["app-server", "--stdio"], { cwd, stdio: ["pipe", "pipe", "inherit"] });
let id = 0, buffer = "", threadId;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => { const requestId = ++id; pending.set(requestId, { resolve, reject }); child.stdin.write(`${JSON.stringify({ id: requestId, method, params })}\n`); });
child.stdout.on("data", (chunk) => { buffer += chunk; const lines = buffer.split("\n"); buffer = lines.pop(); for (const line of lines) { if (!line) continue; const msg = JSON.parse(line); if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); } else if (msg.method) console.log(`event ${msg.method}`); } });
try {
  await send("initialize", { clientInfo: { name: "codex_control_smoke", title: "Codex Control Smoke", version: "0.1.0" }, capabilities: { experimentalApi: true, requestAttestation: false } });
  child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
  const models = await send("model/list", { limit: 1 });
  const threads = await send("thread/list", { limit: 1, cwd });
  const started = await send("thread/start", { cwd, ephemeral: true }); threadId = started.thread.id;
  const turn = await send("turn/start", { threadId, input: [{ type: "text", text: "Reply with exactly: smoke-ok", text_elements: [] }] });
  console.log(JSON.stringify({ ok: true, models: models.data?.length ?? 0, threads: threads.data?.length ?? 0, threadId, turnId: turn.turn.id }));
} finally { child.kill("SIGTERM"); rmSync(cwd, { recursive: true, force: true }); }
