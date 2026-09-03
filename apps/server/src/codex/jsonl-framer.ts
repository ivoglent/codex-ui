import { EventEmitter } from "node:events";
import type { RpcMessage } from "./types.js";

export interface FramerEvents {
  message: [RpcMessage];
  malformed: [Error, string];
}

export class JsonlFramer extends EventEmitter<FramerEvents> {
  private buffer = "";

  push(chunk: Buffer | string): void {
    this.buffer += chunk.toString();
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!parsed || typeof parsed !== "object") throw new Error("JSONL value must be an object");
        this.emit("message", parsed as RpcMessage);
      } catch (error) {
        this.emit("malformed", error instanceof Error ? error : new Error(String(error)), line);
      }
    }
  }

  reset(): void {
    this.buffer = "";
  }
}
