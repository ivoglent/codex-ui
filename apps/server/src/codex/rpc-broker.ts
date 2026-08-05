import { EventEmitter } from "node:events";
import type { Writable } from "node:stream";
import { isRequest, isResponse, type RpcMessage, type RpcNotification, type RpcRequest } from "./types.js";

export class RpcError extends Error {
  constructor(public readonly code: number, message: string, public readonly data?: unknown) {
    super(message);
  }
}

interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
interface BrokerEvents { notification: [RpcNotification]; serverRequest: [RpcRequest]; unknown: [RpcMessage] }

export class RpcBroker extends EventEmitter<BrokerEvents> {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly writer: Writable, private readonly timeoutMs = 60_000) { super(); }

  request<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcError(-32000, `RPC ${method} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params: unknown = {}): void { this.write({ method, params }); }

  respond(id: number | string, result?: unknown, error?: { code: number; message: string; data?: unknown }): void {
    this.write(error ? { id, error } : { id, result: result ?? {} });
  }

  accept(message: RpcMessage): void {
    if (isResponse(message)) {
      const id = typeof message.id === "number" ? message.id : Number.NaN;
      const pending = this.pending.get(id);
      if (!pending) { this.emit("unknown", message); return; }
      clearTimeout(pending.timer);
      this.pending.delete(id);
      if (message.error) pending.reject(new RpcError(message.error.code, message.error.message, message.error.data));
      else pending.resolve(message.result);
      return;
    }
    if (isRequest(message)) { this.emit("serverRequest", message); return; }
    if ("method" in message) { this.emit("notification", message); return; }
    this.emit("unknown", message);
  }

  failAll(error: Error): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }

  get pendingCount(): number { return this.pending.size; }

  private write(message: RpcMessage): void {
    if (!this.writer.write(`${JSON.stringify(message)}\n`)) {
      // Streams serialize writes; backpressure only delays flushing and does not permit reordering.
    }
  }
}
