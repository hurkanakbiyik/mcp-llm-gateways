import type { CaseResult } from "./report.js";

export type CaseOutcome = Omit<CaseResult, "task" | "rep">;

export interface EvalCase { id: string; run: () => Promise<CaseOutcome> }

export interface TaskEval { task: string; cases: EvalCase[] }
