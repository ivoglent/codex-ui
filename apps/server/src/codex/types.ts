export type RpcId = number | string;

export interface RpcRequest {
  id: RpcId;
  method: string;
  params?: unknown;
}

export interface RpcNotification {
  method: string;
  params?: unknown;
}

export interface RpcResponse {
  id: RpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export type RpcMessage = RpcRequest | RpcNotification | RpcResponse;

export const isResponse = (value: RpcMessage): value is RpcResponse =>
  "id" in value && ("result" in value || "error" in value) && !("method" in value);

export const isRequest = (value: RpcMessage): value is RpcRequest =>
  "id" in value && "method" in value;
