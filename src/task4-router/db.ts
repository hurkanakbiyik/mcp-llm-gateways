import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SQLITE_BUSY = 5;
const SETUP_ATTEMPTS = 50;
const SETUP_BACKOFF_MS = 20;

/**
 * Runs one-time setup, retrying on SQLITE_BUSY. When several processes open
 * the file at once, SQLite can return BUSY for the WAL switch and the first
 * schema write without calling the busy handler (deadlock avoidance), so
 * busy_timeout alone is not enough. Found by tests/task4-multiprocess.test.ts.
 * Startup only, so a blocking sleep is fine here.
 */
function setupWithRetry(db: DatabaseSync, sql: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      return db.exec(sql);
    } catch (err) {
      if ((err as { errcode?: number }).errcode !== SQLITE_BUSY || attempt >= SETUP_ATTEMPTS) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, SETUP_BACKOFF_MS * attempt);
    }
  }
}

/** Opens (and migrates) the on-disk SQLite file that holds rate-limit state. */
export function openDb(path: string): DatabaseSync {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from validated operator config
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 5000;"); // wait, don't fail, when another process holds the lock
  setupWithRetry(db, "PRAGMA journal_mode = WAL;"); // readers never block the writer
  setupWithRetry(db, `
    PRAGMA synchronous = NORMAL;    -- durable enough for rate-limit counters
    CREATE TABLE IF NOT EXISTS token_usage (
      id     INTEGER PRIMARY KEY,
      tenant TEXT    NOT NULL,
      ts     INTEGER NOT NULL,      -- epoch ms when the tokens were reserved
      tokens INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_tenant_ts ON token_usage (tenant, ts);
    CREATE INDEX IF NOT EXISTS idx_usage_ts ON token_usage (ts);
  `);
  return db;
}
