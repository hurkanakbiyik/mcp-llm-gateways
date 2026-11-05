import { holdStart, redact } from "./patterns.js";

// RFC 5321 caps an email address at 254 chars, the longest pattern we match.
export const DEFAULT_MAX_HOLD = 256;

export interface StreamRedactor {
  /** Feed a delta; returns text that is safe to send now (may be ""). */
  push(delta: string): string;
  /** End of stream: returns the redacted remainder. */
  flush(): string;
  /** Characters currently held back. At most maxHold plus the size of the last delta. */
  readonly held: number;
}

/**
 * Streaming PII redactor. It emits everything except the trailing run of
 * characters that could still become part of a match, so a match split
 * across chunks ("john.doe@exa" + "mple.com") is still caught. For normal
 * prose the hold is one partial word, so added latency is about one token.
 *
 * Guarantee: for PII shorter than maxHold, output equals redact(fullText)
 * no matter how the text is split into deltas.
 */
export function createRedactor(maxHold = DEFAULT_MAX_HOLD): StreamRedactor {
  let carry = "";
  return {
    push(delta) {
      carry += delta;
      const cut = holdStart(carry, maxHold);
      if (cut === 0) return "";
      const out = redact(carry.slice(0, cut));
      carry = carry.slice(cut);
      return out;
    },
    flush() {
      const out = redact(carry);
      carry = "";
      return out;
    },
    get held() {
      return carry.length;
    },
  };
}
