export type JsonObject = Record<string, unknown>;

export interface RpcErrorShape {
  code: number;
  message: string;
  data?: unknown;
}

export interface ProjectConfig {
  id: string;
  name: string;
  root: string;
  codeServerUrl: string;
  fileUrlTemplate?: string;
  defaults?: Record<string, unknown>;
}

export interface BrowserHello { type: "hello"; clientId: string; lastGenerationId?: string; lastSequence?: number }
export interface BrowserRpcRequest { type: "rpc.request"; requestId: string; method: string; params?: unknown }
export interface BrowserServerResponse { type: "codex.serverRequestResponse"; requestKey: string; result?: unknown; error?: RpcErrorShape }
export type BrowserInbound = BrowserHello | BrowserRpcRequest | BrowserServerResponse;
