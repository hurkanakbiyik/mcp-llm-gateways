import { logger } from "../shared/log.js";
import { UpstreamError, type CompletionRequest, type CompletionResult, type LlmProvider } from "../providers/types.js";

export const DEFAULT_TIMEOUT_MS = 3000;

// Spec: fail over on 429 or timeout. Other failures (5xx, bad request) are
// not retried on the backup, so a broken request isn't sent twice.
const FAILOVER_ON = new Set(["rate_limited", "timeout"]);

/**
 * Runs one provider call with a hard deadline. Promise.race guarantees the
 * caller gets an answer at the deadline even if the adapter ignores the
 * signal; the abort then cancels the in-flight HTTP request so a late
 * primary response can never be used or leak sockets.
 */
export async function callWithTimeout(provider: LlmProvider, req: CompletionRequest, timeoutMs: number, parent?: AbortSignal): Promise<CompletionResult> {
  const timer = new AbortController();
  const signal = parent ? AbortSignal.any([parent, timer.signal]) : timer.signal;
  let handle: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    handle = setTimeout(() => {
      timer.abort();
      reject(new UpstreamError("timeout", undefined, `${provider.name} exceeded ${timeoutMs}ms`));
    }, timeoutMs);
  });
  const call = provider.complete(req, signal);
  call.catch(() => {}); // the loser of the race must not raise an unhandled rejection
  try {
    return await Promise.race([call, deadline]);
  } finally {
    clearTimeout(handle);
  }
}

export interface Routed { result: CompletionResult; provider: string; attempts: number }

/** Tries providers in order, moving to the next only on 429 or timeout. */
export async function routeWithFallback(providers: LlmProvider[], req: CompletionRequest, timeoutMs = DEFAULT_TIMEOUT_MS, signal?: AbortSignal): Promise<Routed> {
  let lastError: unknown;
  for (const [i, provider] of providers.entries()) {
    try {
      const result = await callWithTimeout(provider, req, timeoutMs, signal);
      return { result, provider: provider.name, attempts: i + 1 };
    } catch (err) {
      lastError = err;
      const retryable = err instanceof UpstreamError && FAILOVER_ON.has(err.kind);
      const upstream = err instanceof UpstreamError ? err : undefined;
      logger.warn({ provider: provider.name, kind: upstream?.kind ?? "unknown", status: upstream?.status }, "provider attempt failed");
      // Raw upstream bodies may contain secrets: debug level only (off by default).
      logger.debug({ provider: provider.name, detail: upstream?.detail ?? String(err) }, "provider failure detail");
      if (!retryable || signal?.aborted) break;
    }
  }
  throw lastError;
}
