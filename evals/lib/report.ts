import { mkdirSync, writeFileSync } from "node:fs";

export interface CaseResult {
  task: string;
  id: string;
  rep: number;
  /** Atomic checks. A case passes only if every check passes. */
  checks: Record<string, boolean>;
  notes?: string;
  metrics?: Record<string, number>;
  trace?: unknown;
}

export interface InfraError { task: string; id: string; rep: number; error: string }

export const passed = (r: CaseResult) => Object.values(r.checks).every(Boolean);

/** Writes results.json, errors.json and one transcript file per case. Returns the folder. */
export function writeRun(results: CaseResult[], errors: InfraError[], meta: Record<string, unknown>): string {
  const dir = `evals/results/${new Date().toISOString().replace(/[:.]/g, "-")}`;
  mkdirSync(`${dir}/traces`, { recursive: true });
  for (const r of results) writeFileSync(`${dir}/traces/${r.task}-${r.id}-rep${r.rep}.json`, JSON.stringify(r.trace ?? null, null, 2));
  writeFileSync(`${dir}/results.json`, JSON.stringify({ meta, results: results.map(({ trace: _t, ...r }) => ({ ...r, pass: passed(r) })) }, null, 2));
  writeFileSync(`${dir}/errors.json`, JSON.stringify(errors, null, 2));
  return dir;
}

/** Per-task pass rate and per-check failure counts, written to stderr. */
export function printSummary(results: CaseResult[], errors: InfraError[]): void {
  const out = (s: string) => process.stderr.write(s + "\n");
  for (const task of [...new Set(results.map((r) => r.task))]) {
    const rows = results.filter((r) => r.task === task);
    const ok = rows.filter(passed).length;
    out(`\n${task}: ${ok}/${rows.length} cases passed (${((100 * ok) / rows.length).toFixed(0)}%)`);
    for (const r of rows.filter((x) => !passed(x))) {
      const failed = Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k);
      out(`  FAIL ${r.id} rep${r.rep}: ${failed.join(", ")}${r.notes ? ` | ${r.notes.slice(0, 160)}` : ""}`);
    }
    const refused = rows.filter((r) => r.metrics?.refused).length;
    if (refused) out(`  refusals (scored on hard checks only): ${refused}`);
    const metricKeys = [...new Set(rows.flatMap((r) => Object.keys(r.metrics ?? {})))];
    for (const k of metricKeys) {
      const vals = rows.map((r) => r.metrics?.[k]).filter((v): v is number => v !== undefined).sort((a, b) => a - b);
      out(`  ${k}: median ${vals[Math.floor(vals.length / 2)]?.toFixed(1)}, max ${vals.at(-1)?.toFixed(1)}`);
    }
  }
  if (errors.length) out(`\n${errors.length} infra errors (not scored): ${errors.map((e) => `${e.task}/${e.id}`).join(", ")}`);
}
