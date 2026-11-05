export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }

export interface CompletionRequest {
  model?: string;
  messages: ChatMessage[];
  max_tokens?: number;
}

export interface CompletionResult {
  text: string;
  model: string;
  usage: { total_tokens: number };
}

export type UpstreamErrorKind = "rate_limited" | "timeout" | "http_error" | "network";

/**
 * Normalized upstream failure. `detail` holds the raw upstream body. It never
 * reaches a client, and it is non-enumerable so `logger.x({ err })` does not
 * copy it into logs: upstream bodies can echo credentials. Log it explicitly,
 * at debug level only.
 */
export class UpstreamError extends Error {
  declare readonly detail?: string;
  constructor(readonly kind: UpstreamErrorKind, readonly status?: number, detail?: string) {
    super(`upstream ${kind}${status ? ` (${status})` : ""}`);
    Object.defineProperty(this, "detail", { value: detail, enumerable: false });
  }
}

export interface LlmProvider {
  readonly name: string;
  /** Yields text deltas as they arrive. Must stop when `signal` aborts. */
  stream(req: CompletionRequest, signal: AbortSignal): AsyncIterable<string>;
  complete(req: CompletionRequest, signal: AbortSignal): Promise<CompletionResult>;
}
