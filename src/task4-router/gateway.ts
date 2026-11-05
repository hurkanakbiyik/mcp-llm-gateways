import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { z } from "zod";
import { BodyTooLargeError, bearerToken, handleHealth, readBody, sendJson } from "../shared/http.js";
import { logger } from "../shared/log.js";
import type { LlmProvider } from "../providers/types.js";
import { GatewayError, errorPayload, toGatewayError } from "./errors.js";
import { DEFAULT_TIMEOUT_MS, routeWithFallback } from "./fallback.js";
import type { TokenRateLimiter } from "./rate-limiter.js";
import { DEFAULT_MAX_TOKENS, estimateTokens } from "./tokens.js";

const ChatRequest = z.object({
  model: z.string().optional(),
  messages: z.array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string() })).min(1),
  max_tokens: z.number().int().positive().max(32_000).optional(),
});

export interface RouterGatewayOptions {
  providers: LlmProvider[]; // [primary, secondary, ...]
  limiter: TokenRateLimiter;
  tenants: Map<string, string>; // api key -> tenant id
  timeoutMs?: number;
}

async function parse(req: import("node:http").IncomingMessage) {
  let json: unknown;
  try {
    json = JSON.parse(await readBody(req));
  } catch (err) {
    throw new GatewayError(err instanceof BodyTooLargeError ? 413 : 400, "invalid_request", err instanceof BodyTooLargeError ? "Request body too large." : "Body must be valid JSON.");
  }
  const parsed = ChatRequest.safeParse(json);
  if (!parsed.success) throw new GatewayError(400, "invalid_request", z.prettifyError(parsed.error));
  return parsed.data;
}

/** POST /v1/chat/completions with per-tenant token limits and model fallback. */
export function createRouterGateway({ providers, limiter, tenants, timeoutMs = DEFAULT_TIMEOUT_MS }: RouterGatewayOptions): Server {
  return createServer(async (req, res) => {
    if (handleHealth(req, res)) return;
    const requestId = `req_${randomUUID()}`;
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    let reservation: number | undefined;
    try {
      if (req.method !== "POST" || req.url !== "/v1/chat/completions") throw new GatewayError(404, "invalid_request", "Use POST /v1/chat/completions.");
      const tenant = tenants.get(bearerToken(req) ?? "");
      if (!tenant) throw new GatewayError(401, "authentication_error", "Missing or invalid API key.");
      const body = await parse(req);

      const estimate = estimateTokens(body.messages, body.max_tokens ?? DEFAULT_MAX_TOKENS);
      const r = limiter.reserve(tenant, estimate);
      if (!r.ok && r.reason === "exceeds_limit") throw new GatewayError(400, "invalid_request", `Request needs ~${estimate} tokens, above the ${limiter.limit} tokens/minute limit.`);
      if (!r.ok) throw new GatewayError(429, "rate_limit_exceeded", `Token rate limit of ${limiter.limit}/min exceeded.`, r.retryAfterMs);
      reservation = r.id;

      const routed = await routeWithFallback(providers, body, timeoutMs, abort.signal);
      limiter.commit(r.id, routed.result.usage.total_tokens || estimate);
      logger.info({ requestId, tenant, provider: routed.provider, attempts: routed.attempts }, "completion served");
      sendJson(res, 200, {
        id: requestId,
        object: "chat.completion",
        model: routed.result.model,
        choices: [{ index: 0, message: { role: "assistant", content: routed.result.text }, finish_reason: "stop" }],
        usage: routed.result.usage,
      }, { "x-request-id": requestId });
    } catch (err) {
      if (reservation !== undefined) limiter.release(reservation);
      const gErr = toGatewayError(err);
      logger[gErr.status >= 500 ? "error" : "warn"]({ requestId, type: gErr.type, err }, "request failed");
      if (res.headersSent || abort.signal.aborted) return;
      const headers: Record<string, string> = { "x-request-id": requestId };
      if (gErr.retryAfterMs !== undefined) headers["retry-after"] = String(Math.max(1, Math.ceil(gErr.retryAfterMs / 1000)));
      sendJson(res, gErr.status, errorPayload(gErr, requestId), headers);
    }
  });
}
