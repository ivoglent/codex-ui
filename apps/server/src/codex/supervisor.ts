import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { Duplex, Writable } from "node:stream";
import WebSocket, { type RawData } from "ws";
import { JsonlFramer } from "./jsonl-framer.js";
import { RpcBroker } from "./rpc-broker.js";
import { redactText } from "../observability/redaction.js";

export type SupervisorState = "STOPPED" | "STARTING" | "INITIALIZING" | "READY" | "DEGRADED" | "RESTARTING" | "FAILED";
export interface SupervisorStatus { state: SupervisorState; generationId: string | null; pid: number | null; startedAt: string | null; restartCount: number; protocolErrors: number; lastError: string | null }
export interface SupervisorOptions {
  executable?: string; args?: string[]; cwd?: string; env?: NodeJS.ProcessEnv; transport?: "jsonl" | "websocket"; startupTimeoutMs?: number; requestTimeoutMs?: number;
  restart?: { enabled: boolean; minDelayMs: number; maxDelayMs: number; maxRestartsPerMinute: number };
}
interface SupervisorEvents { status: [SupervisorStatus]; notification: [string, unknown]; serverRequest: [number | string, string, unknown]; stderr: [string]; malformed: [string] }

export class AppServerSupervisor extends EventEmitter<SupervisorEvents> {
  private child: ChildProcessWithoutNullStreams | null = null;
  private webSocket: WebSocket | null = null;
  private brokerValue: RpcBroker | null = null;
  private stopping = false;
  private restartTimes: number[] = [];
  private restartTimer: NodeJS.Timeout | null = null;
  private statusValue: SupervisorStatus = { state: "STOPPED", generationId: null, pid: null, startedAt: null, restartCount: 0, protocolErrors: 0, lastError: null };
  private readonly options: Required<Omit<SupervisorOptions, "env">> & { env?: NodeJS.ProcessEnv };

  constructor(options: SupervisorOptions = {}) {
    super();
    this.options = {
      executable: options.executable ?? "codex", args: options.args ?? ["app-server", "--stdio"], cwd: options.cwd ?? process.cwd(), env: options.env,
      transport: options.transport ?? (options.args?.[0] === "app-server" && options.args[1] === "proxy" ? "websocket" : "jsonl"),
      startupTimeoutMs: options.startupTimeoutMs ?? 20_000, requestTimeoutMs: options.requestTimeoutMs ?? 60_000,
      restart: options.restart ?? { enabled: true, minDelayMs: 1_000, maxDelayMs: 30_000, maxRestartsPerMinute: 5 }
    };
  }

  get status(): SupervisorStatus { return { ...this.statusValue }; }
  get broker(): RpcBroker { if (!this.brokerValue) throw new Error("App-server is not running"); return this.brokerValue; }

  async start(): Promise<void> {
    if (this.child) return;
    this.stopping = false;
    this.setState("STARTING");
    const child = spawn(this.options.executable, this.options.args, { cwd: this.options.cwd, env: this.options.env ?? process.env, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    this.statusValue = { ...this.statusValue, generationId: randomUUID(), pid: child.pid ?? null, startedAt: new Date().toISOString(), lastError: null };
    child.once("error", (error) => this.onExit(error));
    child.once("exit", (code, signal) => this.onExit(new Error(`app-server exited (${signal ?? code ?? "unknown"})`)));
    const framer = new JsonlFramer();
    child.stderr.on("data", (chunk) => { const stderr = redactText(chunk.toString()).trim(); if (stderr) { this.statusValue.lastError = stderr.slice(-2_000); this.emitStatus(); } this.emit("stderr", stderr); });
    framer.on("malformed", (error) => { this.statusValue.protocolErrors++; this.statusValue.lastError = error.message; this.emit("malformed", error.message); this.emitStatus(); });
    let broker: RpcBroker;
    if (this.options.transport === "websocket") {
      let socket: WebSocket;
      try { socket = await this.openProxyWebSocket(child); }
      catch (error) { this.setState("DEGRADED", error); await this.stopChild(); throw error; }
      this.webSocket = socket;
      const writer = new Writable({
        write(chunk, _encoding, callback) {
          if (socket.readyState !== WebSocket.OPEN) return callback(new Error("app-server WebSocket is not open"));
          socket.send(chunk.toString().replace(/\n$/, ""), callback);
        }
      });
      broker = new RpcBroker(writer, this.options.requestTimeoutMs);
      socket.on("message", (data: RawData, isBinary: boolean) => {
        if (isBinary) return framer.emit("malformed", new Error("app-server sent a binary WebSocket message"), "");
        framer.push(`${data.toString()}\n`);
      });
    } else {
      broker = new RpcBroker(child.stdin, this.options.requestTimeoutMs);
      child.stdout.on("data", (chunk) => framer.push(chunk));
    }
    this.brokerValue = broker;
    framer.on("message", (message) => broker.accept(message));
    broker.on("notification", ({ method, params }) => this.emit("notification", method, params));
    broker.on("serverRequest", ({ id, method, params }) => this.emit("serverRequest", id, method, params));
    this.setState("INITIALIZING");
    const startup = broker.request("initialize", { clientInfo: { name: "codex_control_pwa", title: "Codex Control PWA", version: "0.1.0" }, capabilities: { experimentalApi: true, requestAttestation: false, mcpServerOpenaiFormElicitation: true } });
    let startupTimer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => { startupTimer = setTimeout(() => reject(new Error("app-server initialization timed out")), this.options.startupTimeoutMs); });
    try { await Promise.race([startup, timeout]); broker.notify("initialized", {}); this.setState("READY"); }
    catch (error) { this.setState("DEGRADED", error); await this.stopChild(); throw error; }
    finally { if (startupTimer) clearTimeout(startupTimer); }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    await this.stopChild();
    this.setState("STOPPED");
  }

  private async stopChild(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.webSocket?.close();
    this.webSocket = null;
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => child.kill("SIGKILL"), 2_000);
      child.once("exit", () => { clearTimeout(force); resolve(); });
      child.kill("SIGTERM");
    });
  }

  private openProxyWebSocket(child: ChildProcessWithoutNullStreams): Promise<WebSocket> {
    const stream = Duplex.from({ readable: child.stdout, writable: child.stdin }) as Duplex & {
      setTimeout: (timeout?: number, callback?: () => void) => Duplex;
      setNoDelay: () => Duplex;
      setKeepAlive: () => Duplex;
    };
    stream.setTimeout = (_timeout?: number, callback?: () => void) => { if (callback) stream.once("timeout", callback); return stream; };
    stream.setNoDelay = () => stream;
    stream.setKeepAlive = () => stream;
    // Codex's Unix listener uses tungstenite without compression negotiation.
    // The ws client enables permessage-deflate by default, which Codex 0.146
    // closes during the upgrade instead of ignoring.
    const socket = new WebSocket("ws://localhost/rpc", { createConnection: () => stream, perMessageDeflate: false });
    return new Promise<WebSocket>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); socket.terminate(); reject(new Error("app-server proxy WebSocket handshake timed out")); }, this.options.startupTimeoutMs);
      const onOpen = () => { cleanup(); resolve(socket); };
      const onError = (error: Error) => { cleanup(); reject(new Error(`app-server proxy WebSocket handshake failed: ${error.message}`)); };
      const cleanup = () => { clearTimeout(timer); socket.off("open", onOpen); socket.off("error", onError); };
      socket.once("open", onOpen);
      socket.once("error", onError);
    });
  }

  private onExit(error: Error): void {
    if (!this.child) return;
    this.brokerValue?.failAll(error);
    this.child = null; this.brokerValue = null;
    this.statusValue.pid = null; this.statusValue.lastError = error.message;
    if (this.stopping) return;
    if (!this.options.restart.enabled) return this.setState("FAILED", error);
    const now = Date.now();
    this.restartTimes = this.restartTimes.filter((time) => now - time < 60_000);
    if (this.restartTimes.length >= this.options.restart.maxRestartsPerMinute) return this.setState("FAILED", new Error("restart rate limit exceeded"));
    this.restartTimes.push(now); this.statusValue.restartCount++;
    const delay = Math.min(this.options.restart.maxDelayMs, this.options.restart.minDelayMs * 2 ** Math.max(0, this.restartTimes.length - 1));
    this.setState("RESTARTING", error);
    this.restartTimer = setTimeout(() => void this.start().catch(() => undefined), delay);
  }

  private setState(state: SupervisorState, error?: unknown): void { this.statusValue.state = state; if (error) this.statusValue.lastError = error instanceof Error ? error.message : String(error); this.emitStatus(); }
  private emitStatus(): void { this.emit("status", this.status); }
}
