import { createServer, type Server } from "node:http";
import { BodyTooLargeError, bearerToken, handleHealth, readBody, sendJson } from "../shared/http.js";
import { RpcError, envelopeProblem, idOf, rpcError, type JsonRpcId } from "../shared/jsonrpc.js";
import { logger } from "../shared/log.js";
import { verifyToken } from "./auth.js";
import { forward } from "./forward.js";
import { authorize } from "./policy.js";

export interface GatewayOptions { downstreamUrl: string; jwtSecret: string }

export function createMcpGateway({ downstreamUrl, jwtSecret }: GatewayOptions): Server {
  return createServer(async (req, res) => {
    if (handleHealth(req, res)) return;
    const token = bearerToken(req);
    const principal = token ? verifyToken(token, jwtSecret) : null;
    if (!principal) {
      return sendJson(res, 401, rpcError(null, RpcError.Unauthenticated, "Missing or invalid bearer token"), { "www-authenticate": "Bearer" });
    }

    let id: JsonRpcId = null;
    try {
      // GET (SSE stream) and DELETE (session end) carry no JSON-RPC body to inspect.
      if (req.method !== "POST") return await forward(req, res, downstreamUrl, principal);

      const raw = await readBody(req);
      let msg: unknown;
      try {
        msg = JSON.parse(raw);
      } catch {
        return sendJson(res, 200, rpcError(null, RpcError.ParseError, "Parse error"));
      }
      // MCP removed JSON-RPC batching (2025-06-18). Rejecting arrays also
      // stops a denied call from hiding inside a batch.
      id = idOf(msg);
      if (Array.isArray(msg)) return sendJson(res, 200, rpcError(null, RpcError.InvalidRequest, "Batch requests are not supported"));
      const problem = envelopeProblem(msg);
      if (problem) return sendJson(res, 200, rpcError(id, RpcError.InvalidRequest, `Invalid Request: ${problem}`));

      const decision = authorize(principal.role, msg as Record<string, unknown>);
      if (!decision.allow) {
        logger.warn({ sub: principal.sub, role: principal.role, tool: (msg as { params?: { name?: unknown } }).params?.name }, "tool call denied");
        return sendJson(res, 200, decision.response);
      }
      await forward(req, res, downstreamUrl, principal, raw);
    } catch (err) {
      if (err instanceof BodyTooLargeError) return sendJson(res, 413, rpcError(null, RpcError.InvalidRequest, "Request body too large"));
      logger.error({ err }, "downstream failure");
      if (!res.headersSent) sendJson(res, 502, rpcError(id, RpcError.InternalError, "Downstream MCP server unavailable"));
      else res.destroy();
    }
  });
}
