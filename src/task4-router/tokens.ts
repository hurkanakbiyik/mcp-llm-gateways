import type { ChatMessage } from "../providers/types.js";

export const DEFAULT_MAX_TOKENS = 1024;

/**
 * Cheap pre-flight estimate: ~4 chars per token plus a small per-message
 * overhead, plus the requested completion budget. The limiter reserves this
 * up front and corrects it with the provider's real usage afterwards.
 */
export function estimateTokens(messages: ChatMessage[], maxTokens = DEFAULT_MAX_TOKENS): number {
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  return Math.ceil(chars / 4) + messages.length * 4 + maxTokens;
}
