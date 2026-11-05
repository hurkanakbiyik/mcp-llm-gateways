// JSON-RPC 2.0 wire types and error helpers shared by the gateways.
export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown> | unknown[];
}

export const RpcError = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  // Implementation-defined server errors (-32000..-32099)
  Unauthenticated: -32000,
  UnauthorizedToolCall: -32001,
} as const;

export function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0" as const, id, error: data === undefined ? { code, message } : { code, message, data } };
}

/** Validates the JSON-RPC 2.0 request envelope. Returns an error message or null. */
export function envelopeProblem(msg: unknown): string | null {
  if (typeof msg !== "object" || msg === null || Array.isArray(msg)) return "request must be a JSON object";
  const m = msg as Record<string, unknown>;
  if (m.jsonrpc !== "2.0") return 'jsonrpc must be "2.0"';
  if (typeof m.method !== "string" || m.method.length === 0) return "method must be a non-empty string";
  if ("id" in m && !(typeof m.id === "string" || typeof m.id === "number" || m.id === null)) return "id must be a string, number or null";
  if ("params" in m && (typeof m.params !== "object" || m.params === null)) return "params must be an object or array";
  return null;
}

export function idOf(msg: unknown): JsonRpcId {
  if (typeof msg === "object" && msg !== null && "id" in msg) {
    const id = (msg as { id: unknown }).id;
    if (typeof id === "string" || typeof id === "number") return id;
  }
  return null;
}
