import { describe, expect, it } from "vitest";
import { luhnValid, redact } from "../src/task3-llm-guardrail/patterns.js";
import { createRedactor } from "../src/task3-llm-guardrail/redactor.js";

function streamThrough(text: string, sizes: () => number): string {
  const r = createRedactor();
  let out = "";
  for (let i = 0; i < text.length; ) {
    const n = sizes();
    out += r.push(text.slice(i, i + n));
    i += n;
  }
  return out + r.flush();
}

// Deterministic PRNG so failures reproduce.
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

describe("PII patterns (Task 3)", () => {
  it.each([
    ["john.doe@example.com", true], ["a+tag@sub.mail.co.uk", true], ["x_y%z@host-1.io", true],
    ["123-45-6789", true], ["4111 1111 1111 1111", true], ["4111-1111-1111-1111", true], ["4111111111111111", true], ["378282246310005", true],
    ["4111 1111 1111 1112", false], // fails Luhn
    ["order 1234567890123", false], ["call 555-123-4567", false], ["user@localhost", false], ["2026-11-05", false],
  ])("when the text is %s, then redacted is %s", (input, expected) => {
    expect(redact(input).includes("[REDACTED]")).toBe(expected);
  });

  it("when PII sits next to punctuation, then only the PII is replaced", () => {
    expect(redact("Mail me at a@b.com.")).toBe("Mail me at [REDACTED].");
    expect(redact("SSN:123-45-6789;")).toBe("SSN:[REDACTED];");
  });

  it("when a number passes or fails Luhn, then luhnValid says so", () => {
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("4111111111111112")).toBe(false);
  });
});

describe("Streaming redactor (Task 3)", () => {
  it("when PII is split across deltas, then it is still redacted", () => {
    // Arrange
    const r = createRedactor();
    // Act
    const out = ["Contact john.d", "oe@exa", "mple.com or 4111 11", "11 1111 1111 today"].map((c) => r.push(c)).join("") + r.flush();
    // Assert
    expect(out).toBe("Contact [REDACTED] or [REDACTED] today");
  });

  it("when 500 random texts are split at random points, then output equals whole-text redaction", () => {
    // Arrange
    const rand = rng(42);
    const pii = ["jane@corp.example.org", "123-45-6789", "4111 1111 1111 1111", "5555-5555-5555-4444", "378282246310005", "bob_smith+x@mail.io"];
    const words = ["the", "refund", "is", "ready,", "call", "us.", "order", "#12345", "on", "2026-11-05", "(ok)", "email:", "card:"];
    for (let c = 0; c < 500; c++) {
      // Arrange
      const parts: string[] = [];
      for (let i = 0; i < 30; i++) parts.push(rand() < 0.15 ? pii[Math.floor(rand() * pii.length)]! : words[Math.floor(rand() * words.length)]!);
      const text = parts.join(rand() < 0.5 ? " " : "  ");
      // Act + Assert
      expect(streamThrough(text, () => 1 + Math.floor(rand() * 9))).toBe(redact(text));
    }
  });

  it("when streaming prose, then only the trailing partial word is held back", () => {
    // Arrange
    const r = createRedactor();
    // Act + Assert
    expect(r.push("Hello")).toBe("");
    expect(r.push(" world,")).toBe("Hello world,");
    expect(r.push(" how")).toBe(" ");
    expect(r.held).toBe(3);
  });

  it("when words end in digits, then they do not chain into one long hold", () => {
    const r = createRedactor();
    expect(r.push("word0 word1 word2 ")).toBe("word0 word1 ");
  });

  it("when a run never breaks, then the held buffer stays bounded", () => {
    // Arrange
    const r = createRedactor(256);
    let maxHeld = 0;
    // Act
    for (let i = 0; i < 100_000; i++) {
      r.push("abcdefghij");
      maxHeld = Math.max(maxHeld, r.held);
    }
    // Assert
    expect(maxHeld).toBeLessThanOrEqual(256 + 10);
  });

  it.each([
    ["a long local-part run", "a".repeat(20_000) + "!"],
    ["dotted labels with no TLD", "x@" + "a.".repeat(10_000) + "1"],
    ["a long digit run", "1".repeat(20_000)],
  ])("when the input is %s (20 KB), then redact() stays linear (no ReDoS, nodebestpractices 6.16)", (_label, input) => {
    // Act
    const start = performance.now();
    redact(input);
    // Assert: the unbounded pattern took ~620 ms here; bounded takes ~5 ms.
    expect(performance.now() - start).toBeLessThan(100);
  });

  it("when streaming 5 MB of token-sized deltas, then throughput stays above 1 MB/s", () => {
    // Arrange
    const r = createRedactor();
    const token = "Lorem ipsum dolor sit amet, mail a@b.co card 4111111111111111. ";
    const start = performance.now();
    let bytes = 0;
    while (bytes < 5_000_000) {
    // Act
      for (const piece of token.match(/.{1,4}/g)!) r.push(piece);
      bytes += token.length;
    }
    const msPerMb = (performance.now() - start) / 5;
    // Assert
    expect(msPerMb).toBeLessThan(1000);
  });
});
