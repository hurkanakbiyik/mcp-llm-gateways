import { UpstreamError } from "../providers/types.js";

export type GatewayErrorType =
  | "invalid_request"
  | "authentication_error"
  | "rate_limit_exceeded"
  | "upstream_unavailable"
  | "upstream_error"
  | "internal_error";

/** An error that is safe to show a client: fixed type, fixed status, our own message. */
export class GatewayError extends Error {
  constructor(readonly status: number, readonly type: GatewayErrorType, message: string, readonly retryAfterMs?: number) {
    super(message);
  }
}

export interface ErrorPayload { error: { type: GatewayErrorType; message: string; request_id: string } }

/**
 * Maps any thrown value to a standardized gateway error. Upstream bodies,
 * stack traces, hostnames and provider names never cross this boundary;
 * the full detail goes to the server log under the same request_id.
 */
export function toGatewayError(err: unknown): GatewayError {
  if (err instanceof GatewayError) return err;
  if (err instanceof UpstreamError) {
    if (err.kind === "rate_limited" || err.kind === "timeout") {
      return new GatewayError(503, "upstream_unavailable", "All model providers are busy or timed out. Retry shortly.");
    }
    return new GatewayError(502, "upstream_error", "The model provider returned an error. Retry the request; if it keeps failing, contact support with the request_id.");
  }
  return new GatewayError(500, "internal_error", "Internal gateway error.");
}

export function errorPayload(err: GatewayError, requestId: string): ErrorPayload {
  return { error: { type: err.type, message: err.message, request_id: requestId } };
}
