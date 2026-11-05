// Child process for the multi-process limiter test. Usage: limiter-worker <dbPath> <attempts> <tokens>
import { openDb } from "../../src/task4-router/db.js";
import { TokenRateLimiter } from "../../src/task4-router/rate-limiter.js";

const [dbPath, attempts, tokens] = process.argv.slice(2);
const limiter = new TokenRateLimiter(openDb(dbPath!), { limit: 50_000 });
let admitted = 0;
for (let i = 0; i < Number(attempts); i++) if (limiter.reserve("shared-tenant", Number(tokens)).ok) admitted++;
process.stdout.write(String(admitted));
