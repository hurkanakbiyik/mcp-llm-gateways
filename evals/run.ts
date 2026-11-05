// LLM-judged evals. Usage: npm run eval -- [--only task1,task3] [--reps 3]
import "./lib/quiet.js"; // first: sets LOG_SILENT before the logger module loads
import { parseArgs } from "node:util";
import { JUDGE_MODEL, MODEL, hasCredentials, usage } from "./lib/claude.js";
import { printSummary, writeRun, type CaseResult, type InfraError } from "./lib/report.js";
import type { TaskEval } from "./lib/types.js";
import { task1 } from "./task1-mcp-server.eval.js";
import { task2 } from "./task2-mcp-gateway.eval.js";
import { task3 } from "./task3-pii-guardrail.eval.js";
import { task4 } from "./task4-router.eval.js";

const { values } = parseArgs({ options: { only: { type: "string" }, reps: { type: "string", default: "1" } } });
const say = (s: string) => process.stderr.write(s + "\n");

if (!hasCredentials()) {
  say("No Claude credentials. Set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) and re-run `npm run eval`.");
  process.exit(2);
}

const all: Record<string, TaskEval> = { task1, task2, task3, task4 };
const selected = values.only ? values.only.split(",").map((k) => all[k.trim()]).filter((t): t is TaskEval => !!t) : Object.values(all);
const reps = Math.max(1, Number(values.reps));
const results: CaseResult[] = [];
const errors: InfraError[] = [];
const CASE_TIMEOUT_MS = 180_000;

for (const t of selected) {
  for (let rep = 1; rep <= reps; rep++) {
    for (const c of t.cases) {
      say(`${t.task} / ${c.id} / rep ${rep}`);
      try {
        // Hard wall-clock ceiling per case; a hang is an infra error, never a score.
        const outcome = await Promise.race([c.run(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("case timeout")), CASE_TIMEOUT_MS).unref())]);
        results.push({ ...outcome, task: t.task, rep });
      } catch (err) {
        errors.push({ task: t.task, id: c.id, rep, error: String(err) });
      }
    }
  }
}

printSummary(results, errors);
const dir = writeRun(results, errors, { model: MODEL, judge_model: JUDGE_MODEL, reps, usage });
say(`\nClaude calls: ${usage.calls}, tokens in/out: ${usage.input}/${usage.output}, est. cost $${usage.cost.toFixed(2)}`);
say(`Results: ${dir}`);
