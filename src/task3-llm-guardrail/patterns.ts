export const REDACTED = "[REDACTED]";

// One combined, precompiled regex: a single left-to-right scan per chunk.
// Named groups tell the replacer which branch matched.
// Every quantifier is bounded (RFC 5321: local part <= 64, label <= 63).
// Unbounded `+` here made matching quadratic: 20 KB of "aaaa" took ~620 ms
// and blocked the event loop (nodebestpractices 6.16). Bounded: linear.
// eslint-disable-next-line security/detect-non-literal-regexp -- joined from the constant literals below
const PII = new RegExp(
  [
    String.raw`(?<email>[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9\-]{1,63}(?:\.[A-Za-z0-9\-]{1,63}){0,8}\.[A-Za-z]{2,63})`,
    String.raw`(?<ssn>\b\d{3}-\d{2}-\d{4}\b)`,
    // 13-19 digits, optionally grouped by single spaces or dashes.
    String.raw`(?<card>\b\d(?:[ \-]?\d){12,18}\b)`,
  ].join("|"),
  "g",
);

/** Luhn checksum. Keeps order numbers and other long digit runs readable. */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double && (d *= 2) > 9) d -= 9;
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Redacts every complete PII match in `text`. Pure; safe on any string. */
export function redact(text: string): string {
  return text.replace(PII, (match, ...args) => {
    const groups = args.at(-1) as { card?: string };
    if (groups.card !== undefined && !luhnValid(match.replace(/[ -]/g, ""))) return match;
    return REDACTED;
  });
}

// Characters that can appear inside a PII match. A trailing run of these at
// the end of the buffer might still grow into a match with the next chunk.
const RUN_CHAR = /[\w.%+\-@]/;
const DIGIT = /\d/;

/**
 * Index where the trailing "maybe PII" run starts. A space joins the run only
 * between two digits, or after a digit at the very end (card numbers like
 * "4111 1111 ..."), so "word0 word1" does not chain into one long hold.
 * Scans backwards at most `maxHold` chars: O(chunk + maxHold) per chunk.
 */
export function holdStart(buf: string, maxHold: number): number {
  const floor = Math.max(0, buf.length - maxHold);
  let i = buf.length;
  while (i > floor) {
    const c = buf[i - 1]!;
    if (RUN_CHAR.test(c) || (c === " " && DIGIT.test(buf[i - 2] ?? "") && (i === buf.length || DIGIT.test(buf[i]!)))) i--;
    else break;
  }
  return i;
}
