import type { DatabaseSync, StatementSync } from "node:sqlite";

export interface LimiterOptions { limit?: number; windowMs?: number; now?: () => number }

export type Reservation =
  | { ok: true; id: number; remaining: number }
  | { ok: false; reason: "rate_limited"; retryAfterMs: number; remaining: number }
  | { ok: false; reason: "exceeds_limit" };

/**
 * Token-aware sliding-window limiter backed by SQLite. Each admitted request
 * is one row (tenant, ts, tokens). The window is exact: a tenant's usage is
 * the sum of rows newer than now - windowMs. Rows older than that are
 * deleted on every reservation, so the table only holds live state.
 *
 * reserve() runs inside BEGIN IMMEDIATE, so check-and-insert is atomic across
 * concurrent requests and across processes sharing the database file.
 */
export class TokenRateLimiter {
  readonly limit: number;
  readonly windowMs: number;
  private readonly now: () => number;
  private readonly q: Record<"evict" | "used" | "rows" | "insert" | "update" | "remove", StatementSync>;

  constructor(private readonly db: DatabaseSync, opts: LimiterOptions = {}) {
    this.limit = opts.limit ?? 50_000;
    this.windowMs = opts.windowMs ?? 60_000;
    this.now = opts.now ?? Date.now;
    this.q = {
      evict: db.prepare("DELETE FROM token_usage WHERE ts <= ?"),
      used: db.prepare("SELECT COALESCE(SUM(tokens), 0) AS used FROM token_usage WHERE tenant = ? AND ts > ?"),
      rows: db.prepare("SELECT ts, tokens FROM token_usage WHERE tenant = ? AND ts > ? ORDER BY ts"),
      insert: db.prepare("INSERT INTO token_usage (tenant, ts, tokens) VALUES (?, ?, ?)"),
      update: db.prepare("UPDATE token_usage SET tokens = ? WHERE id = ?"),
      remove: db.prepare("DELETE FROM token_usage WHERE id = ?"),
    };
  }

  reserve(tenant: string, tokens: number): Reservation {
    if (tokens > this.limit) return { ok: false, reason: "exceeds_limit" };
    const now = this.now();
    const cutoff = now - this.windowMs;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.q.evict.run(cutoff);
      const used = Number((this.q.used.get(tenant, cutoff) as { used: number }).used);
      if (used + tokens > this.limit) {
        this.db.exec("COMMIT");
        return { ok: false, reason: "rate_limited", retryAfterMs: this.retryAfter(tenant, cutoff, used, tokens, now), remaining: this.limit - used };
      }
      const { lastInsertRowid } = this.q.insert.run(tenant, now, tokens);
      this.db.exec("COMMIT");
      return { ok: true, id: Number(lastInsertRowid), remaining: this.limit - used - tokens };
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /** Replace the estimate with the provider-reported usage once known. */
  commit(id: number, actualTokens: number): void {
    this.q.update.run(actualTokens, id);
  }

  /** Give the reservation back (request failed, nothing was served). */
  release(id: number): void {
    this.q.remove.run(id);
  }

  /** Time until enough old rows expire for `tokens` to fit. */
  private retryAfter(tenant: string, cutoff: number, used: number, tokens: number, now: number): number {
    let freed = 0;
    for (const row of this.q.rows.all(tenant, cutoff) as { ts: number; tokens: number }[]) {
      freed += row.tokens;
      if (used - freed + tokens <= this.limit) return Math.max(0, row.ts + this.windowMs - now);
    }
    return this.windowMs;
  }
}
