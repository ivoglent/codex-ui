import readline from "node:readline";

let initialized = false;
let threadCounter = 0;
const longHistory = Array.from({ length: 34 }, (_, index) => ({ id: `history-${index}`, type: "agentMessage", text: `Historical Codex update ${index + 1}. This paragraph contains a long URL https://example.invalid/session/${"x".repeat(90)} and should wrap inside the mobile chat without widening the page.` }));
const seededThread = { id: "thread-existing", cwd: process.cwd(), name: "Fix CI failures", preview: "Please fix the failing CI tests", status: { type: "idle" }, updatedAt: 2, createdAt: 1, turns: [{ id: "turn-existing", status: "completed", error: null, items: [
  { id: "user-existing", type: "userMessage", content: [{ type: "text", text: "Please fix the failing CI tests", text_elements: [] }] },
  { id: "agent-existing", type: "agentMessage", text: "I found the failing workflow and corrected the build configuration." },
  { id: "command-existing", type: "commandExecution", command: "pnpm test", aggregatedOutput: "21 tests passed", status: "completed" },
  ...longHistory
] }] };
const reply = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (line === "MALFORMED_TEST") { process.stdout.write("not-json\n"); return; }
  const message = JSON.parse(line);
  if (message.method === "initialize") { initialized = true; reply({ id: message.id, result: { userAgent: "fake/1", platformFamily: "unix", platformOs: "linux" } }); return; }
  if (message.method === "initialized") return;
  if (!initialized) { reply({ id: message.id, error: { code: -32002, message: "Not initialized" } }); return; }
  if (message.method === "model/list") return reply({ id: message.id, result: { data: [{ id: "fake-model", model: "fake-model" }], nextCursor: null } });
  if (message.method === "thread/list") return reply({ id: message.id, result: { data: message.params.cwd ? [{ ...seededThread, turns: [] }] : [], nextCursor: null } });
  if (message.method === "thread/resume") return reply({ id: message.id, result: { thread: seededThread } });
  if (message.method === "thread/start") { const thread = { id: `thread-${++threadCounter}`, cwd: message.params.cwd ?? process.cwd(), status: { type: "idle" }, turns: [] }; reply({ method: "thread/started", params: { thread } }); return reply({ id: message.id, result: { thread } }); }
  if (message.method === "turn/start") { const turn = { id: "turn-1", items: [], status: "inProgress", error: null }; reply({ id: message.id, result: { turn } }); reply({ method: "turn/started", params: { threadId: message.params.threadId, turn } }); return; }
  if (message.method === "test/serverRequest") return reply({ id: "server-1", method: "item/commandExecution/requestApproval", params: { command: "true" } });
  if (message.method === "test/crash") return process.exit(17);
  reply({ id: message.id, error: { code: -32601, message: "Method not found" } });
});
