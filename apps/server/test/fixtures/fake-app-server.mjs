import readline from "node:readline";
import path from "node:path";

let initialized = false;
let threadCounter = 0;
let approvalCounter = 0;
const expectedApprovalResponses = new Map();
const longHistory = Array.from({ length: 34 }, (_, index) => ({ id: `history-${index}`, type: "agentMessage", text: `Historical Codex update ${index + 1}. This paragraph contains a long URL https://example.invalid/session/${"x".repeat(90)} and should wrap inside the mobile chat without widening the page.` }));
const widthFixture = { id: "width-fixture", type: "agentMessage", text: `## Width regression fixture

- A nested list item with an inline token \`${"inline-token-".repeat(14)}\`
- A UUID 2f1c0f34-1234-4567-89ab-123456789abc and path /home/example/${"very-long-directory/".repeat(9)}file.ts
- Nested content
  - must remain inside the padded message column

| Very wide heading | Another heading | Final heading |
| --- | --- | --- |
| ${"table-cell-".repeat(18)} | normal | normal |

\`\`\`ts
const intentionallyWideCodeLine = "${"wide-code-content-".repeat(24)}";
\`\`\`

![responsive fixture](https://example.invalid/wide-image.png)` };
const fixtureProjectCwd = path.resolve("apps/web/public");
const seededThread = { id: "thread-existing", cwd: process.cwd(), name: "Fix CI failures", preview: "Please fix the failing CI tests", status: { type: "idle" }, updatedAt: 2, createdAt: 1, turns: [{ id: "turn-existing", status: "completed", error: null, items: [
  { id: "user-existing", type: "userMessage", content: [{ type: "text", text: "Please fix the failing CI tests", text_elements: [] }] },
  { id: "agent-existing", type: "agentMessage", text: "I found the failing workflow and corrected the build configuration." },
  { id: "command-existing", type: "commandExecution", command: "pnpm test", aggregatedOutput: "21 tests passed", status: "completed" },
  widthFixture,
  { id: "change-existing", type: "fileChange", status: "completed", changes: [{ path: `/home/example/${"nested-directory/".repeat(12)}changed-file.ts`, kind: "modified" }] },
  ...longHistory
] }] };
const approvalThread = { id: "thread-approval", cwd: fixtureProjectCwd, name: "Approve a command", preview: "Approval popup fixture", status: { type: "idle" }, updatedAt: 1, createdAt: 1, turns: [] };
const terminalApprovalThread = { id: "thread-terminal-approval", cwd: fixtureProjectCwd, name: "Terminal approves command", preview: "Terminal approval fixture", status: { type: "idle" }, updatedAt: 1, createdAt: 1, turns: [] };
const reply = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const rl = readline.createInterface({ input: process.stdin });
const requestApproval = (threadId, terminalResolves = false) => {
  const id = `approval-${++approvalCounter}`;
  expectedApprovalResponses.set(id, "approved_for_session");
  reply({ id, method: "execCommandApproval", params: { threadId, command: ["echo", "approved"], cwd: process.cwd(), reason: "Run the requested command" } });
  if (terminalResolves) setTimeout(() => {
    if (!expectedApprovalResponses.delete(id)) return;
    reply({ method: "serverRequest/resolved", params: { requestId: id, threadId } });
  }, 500);
};
rl.on("line", (line) => {
  if (line === "MALFORMED_TEST") { process.stdout.write("not-json\n"); return; }
  const message = JSON.parse(line);
  if (message.method === "initialize") { initialized = true; reply({ id: message.id, result: { userAgent: "fake/1", platformFamily: "unix", platformOs: "linux" } }); return; }
  if (message.method === "initialized") return;
  if (!initialized) { reply({ id: message.id, error: { code: -32002, message: "Not initialized" } }); return; }
  if (message.method === "model/list") return reply({ id: message.id, result: { data: [{ id: "fake-model", model: "fake-model" }], nextCursor: null } });
  if (message.id && !message.method && expectedApprovalResponses.has(message.id)) {
    const expected = expectedApprovalResponses.get(message.id);
    expectedApprovalResponses.delete(message.id);
    if (message.result?.decision !== expected) setTimeout(() => requestApproval("thread-approval"), 50);
    return;
  }
  if (message.method === "thread/list") return reply({ id: message.id, result: { data: [{ ...seededThread, turns: [] }, approvalThread, terminalApprovalThread], nextCursor: null } });
  if (message.method === "thread/resume") {
    const thread = message.params.threadId === approvalThread.id ? approvalThread : message.params.threadId === terminalApprovalThread.id ? terminalApprovalThread : seededThread;
    reply({ id: message.id, result: { thread } });
    if (thread.id === approvalThread.id) setTimeout(() => requestApproval(thread.id), 20);
    if (thread.id === terminalApprovalThread.id) setTimeout(() => requestApproval(thread.id, true), 20);
    return;
  }
  if (message.method === "thread/start") { const thread = { id: `thread-${++threadCounter}`, cwd: message.params.cwd ?? process.cwd(), status: { type: "idle" }, turns: [] }; reply({ method: "thread/started", params: { thread } }); return reply({ id: message.id, result: { thread } }); }
  if (message.method === "turn/start") { const turn = { id: "turn-1", items: [], status: "inProgress", error: null }; reply({ id: message.id, result: { turn } }); reply({ method: "turn/started", params: { threadId: message.params.threadId, turn } }); return; }
  if (message.method === "test/serverRequest") return reply({ id: "server-1", method: "item/commandExecution/requestApproval", params: { command: "true" } });
  if (message.method === "test/crash") return process.exit(17);
  reply({ id: message.id, error: { code: -32601, message: "Method not found" } });
});
