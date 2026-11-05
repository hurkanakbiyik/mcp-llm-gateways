import { RpcError, idOf, rpcError } from "../shared/jsonrpc.js";
import type { Role } from "./auth.js";

export type Decision = { allow: true } | { allow: false; response: ReturnType<typeof rpcError> };

const ADMIN_PREFIX = "admin_";

/**
 * Method-level authorization for one JSON-RPC message. tools/list and every
 * other method pass through untouched; only tools/call is inspected.
 */
export function authorize(role: Role, msg: Record<string, unknown>): Decision {
  if (msg.method !== "tools/call") return { allow: true };

  const params = msg.params as Record<string, unknown> | undefined;
  const name = params?.name;
  if (typeof name !== "string") {
    return deny(rpcError(idOf(msg), RpcError.InvalidParams, "tools/call requires params.name (string)"));
  }
  // caller_role tells the agent whose permission is missing (the user's
  // token, not the agent's), so it can explain the denial correctly.
  // Case-sensitive on purpose: MCP tool names are case-sensitive, so
  // "Admin_reset_key" is a different tool and the downstream decides on it.
  if (name.startsWith(ADMIN_PREFIX) && role !== "admin") {
    return deny(rpcError(idOf(msg), RpcError.UnauthorizedToolCall, "Unauthorized Tool Call", { tool: name, required_role: "admin", caller_role: role }));
  }
  return { allow: true };
}

function deny(response: ReturnType<typeof rpcError>): Decision {
  return { allow: false, response };
}
