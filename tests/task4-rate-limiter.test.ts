import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/task4-router/db.js";
import { TokenRateLimiter } from "../src/task4-router/rate-limiter.js";
import { estimateTokens } from "../src/task4-router/tokens.js";
import { tmpDbPath } from "./helpers/tmpdb.js";

function setup(limit = 50_000) {
  let now = 1_000_000;
  const path = tmpDbPath();
  const db = openDb(path);
  const limiter = new TokenRateLimiter(db, { limit, windowMs: 60_000, now: () => now });
  const rows = () => Number((db.prepare("SELECT COUNT(*) AS n FROM token_usage").get() as { n: number }).n);
  return { limiter, rows, path, advance: (ms: number) => (now += ms) };
}

describe("Token rate limiter (Task 4)", () => {
  it("when usage reaches the limit, then the next request is rejected", () => {
    // Arrange
    const { limiter } = setup();
    // Act + Assert
    expect(limiter.reserve("t1", 30_000).ok).toBe(true);
    expect(limiter.reserve("t1", 20_000)).toMatchObject({ ok: true, remaining: 0 });
    expect(limiter.reserve("t1", 1)).toMatchObject({ ok: false, reason: "rate_limited" });
  });

  it("when the oldest usage leaves the window, then capacity returns at that exact ms", () => {
    // Arrange
    const { limiter, advance } = setup();
    // Act
    limiter.reserve("t1", 30_000); // t=0
    advance(20_000);
    limiter.reserve("t1", 20_000); // t=20s
    advance(10_000); // t=30s
    const denied = limiter.reserve("t1", 25_000);
    // Assert
    expect(denied).toMatchObject({ ok: false, retryAfterMs: 30_000 }); // first row expires at t=60s
    advance(29_999);
    expect(limiter.reserve("t1", 25_000).ok).toBe(false);
    advance(1); // t=60s: the 30k row is out of the window
    expect(limiter.reserve("t1", 25_000).ok).toBe(true);
  });

  it("when rows are older than the window, then a reservation deletes them", () => {
    // Arrange
    const { limiter, rows, advance } = setup();
    // Act
    for (let i = 0; i < 10; i++) limiter.reserve(`t${i}`, 100);
    // Assert
    expect(rows()).toBe(10);
    advance(60_001);
    limiter.reserve("other", 1);
    expect(rows()).toBe(1);
  });

  it("when one tenant is at its limit, then another tenant is unaffected", () => {
    // Arrange
    const { limiter } = setup();
    // Act
    limiter.reserve("a", 50_000);
    // Assert
    expect(limiter.reserve("a", 1).ok).toBe(false);
    expect(limiter.reserve("b", 50_000).ok).toBe(true);
  });

  it("when committing real usage or releasing, then the budget reflects it", () => {
    // Arrange
    const { limiter } = setup();
    // Act
    const r = limiter.reserve("t", 40_000);
    if (!r.ok) throw new Error("expected ok");
    limiter.commit(r.id, 5_000); // actual usage was smaller
    // Assert
    expect(limiter.reserve("t", 45_000).ok).toBe(true);
    const r2 = limiter.reserve("t2", 50_000);
    if (!r2.ok) throw new Error("expected ok");
    limiter.release(r2.id);
    expect(limiter.reserve("t2", 50_000).ok).toBe(true);
  });

  it("when one request exceeds the whole budget, then it is rejected as exceeds_limit", () => {
    expect(setup().limiter.reserve("t", 50_001)).toEqual({ ok: false, reason: "exceeds_limit" });
  });

  it("when the process restarts, then usage survives on disk", () => {
    // Arrange
    const { limiter, path } = setup();
    // Act
    limiter.reserve("t", 50_000);
    // Assert
    expect(existsSync(path)).toBe(true);
    const reopened = new TokenRateLimiter(openDb(path), { now: () => 1_000_000 });
    expect(reopened.reserve("t", 1).ok).toBe(false);
  });

  it("when estimating, then it counts chars/4 plus overhead plus max_tokens", () => {
    expect(estimateTokens([{ role: "user", content: "x".repeat(400) }], 1000)).toBe(100 + 4 + 1000);
  });
});
