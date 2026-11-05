import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Fresh on-disk SQLite path per test (the spec asks for disk, not :memory:). */
export const tmpDbPath = () => join(mkdtempSync(join(tmpdir(), "router-")), "gateway.sqlite");
