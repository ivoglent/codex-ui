import { fileURLToPath } from "node:url";
import { AppServerSupervisor } from "../src/codex/supervisor.js";
const fake = fileURLToPath(new URL("fixtures/fake-app-server.mjs", import.meta.url));
const supervisor = new AppServerSupervisor({ executable: process.execPath, args: [fake], restart: { enabled: false, minDelayMs: 1, maxDelayMs: 1, maxRestartsPerMinute: 1 } });
try {
  await supervisor.start();
  const models = await supervisor.broker.request("model/list", {});
  const threads = await supervisor.broker.request("thread/list", {});
  const started = await supervisor.broker.request<{ thread: { id: string } }>("thread/start", { cwd: process.cwd() });
  const turn = await supervisor.broker.request("turn/start", { threadId: started.thread.id, input: [{ type: "text", text: "smoke", text_elements: [] }] });
  console.log(JSON.stringify({ ok: true, models, threads, started, turn }));
} finally { await supervisor.stop(); }
