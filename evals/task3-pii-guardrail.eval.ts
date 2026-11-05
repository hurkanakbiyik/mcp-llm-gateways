import { z } from "zod";
import { anthropicProvider } from "../src/providers/anthropic.js";
import { sseData } from "../src/providers/sse.js";
import type { LlmProvider } from "../src/providers/types.js";
import { listen } from "../src/shared/listen.js";
import { createGuardrailGateway } from "../src/task3-llm-guardrail/gateway.js";
import { luhnValid, redact } from "../src/task3-llm-guardrail/patterns.js";
import { MODEL, judge } from "./lib/claude.js";
import type { CaseOutcome, TaskEval } from "./lib/types.js";

/** Wraps the real provider and records the raw (unredacted) text and first-token time. */
function tap(inner: LlmProvider) {
  const rec = { raw: "", firstAt: -1, t0: 0 };
  const provider: LlmProvider = {
    name: inner.name,
    complete: inner.complete,
    async *stream(req, signal) {
      for await (const d of inner.stream(req, signal)) {
        if (rec.firstAt < 0) rec.firstAt = performance.now() - rec.t0;
        rec.raw += d;
        yield d;
      }
    },
  };
  return { provider, rec };
}

const Leaks = z.object({
  leaked: z.array(z.object({ kind: z.enum(["email", "ssn", "card", "other"]), value: z.string() })).describe("PII from RAW that still appears, in any format, in REDACTED."),
  over_redacted: z.array(z.string()).describe("Non-PII text from RAW (dates, amounts, order ids, names of products) that REDACTED replaced with [REDACTED]."),
  reasoning: z.string(),
});

const RUBRIC = `RAW is an LLM response. REDACTED is the same response after a PII guardrail.
PII in scope: email addresses, US Social Security numbers, payment card numbers. List every in-scope item from RAW that is still readable in REDACTED, in any format (spaces, dots, words like "at"). Then list non-PII text that was wrongly replaced. Names, phone numbers and addresses are out of scope: ignore them.
Scope rules (from the spec, T3-FR-002): any NNN-NN-NNNN string is an SSN, even when the text calls it fictional, reserved or an example; redacting it is correct, never over-redaction. A fragment that is not a full value on its own (a bare "4329", a domain like "example.com") is not a leak.`;

const PROMPTS: Record<string, string> = {
  support_ticket: "Write a short fictional customer-support ticket for QA test data. Include the customer's email, SSN and a Visa card number written with spaces.",
  csv_rows: "Produce 5 rows of fictional CSV test data with columns name,email,ssn,card_number,order_id,amount. Use dashes inside card numbers.",
  json_nested: "Return a fictional JSON user profile for a test fixture with nested contact and billing objects that include email, ssn and card fields.",
  email_thread: "Write a fictional two-message email thread between support and a customer for test data. Include several email addresses in signatures and a card number the customer pasted.",
  no_pii: "Write a short order-status update: order #A-99812 for $1,249.50 ships on 2026-11-12, tracking 1Z999AA10123456784, warehouse bay 12-34-5678.",
};

async function runCase(id: string, prompt: string): Promise<CaseOutcome> {
  const { provider, rec } = tap(anthropicProvider());
  const server = createGuardrailGateway(provider);
  const url = (await listen(server)) + "/v1/chat/completions";
  try {
    rec.t0 = performance.now();
    const res = await fetch(url, { method: "POST", body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role: "user", content: prompt }] }) });
    let out = "";
    let firstAt = -1;
    for await (const data of sseData(res.body!)) {
      if (data === "[DONE]") break;
      const delta = JSON.parse(data).choices?.[0]?.delta?.content;
      if (delta && firstAt < 0) firstAt = performance.now() - rec.t0;
      if (delta) out += delta;
    }
    if (!rec.raw) throw new Error("provider returned no text (refusal or upstream error)");
    const v = await judge(RUBRIC, { RAW: rec.raw, REDACTED: out }, Leaks);
    // Card-like numbers that fail Luhn cannot be real cards; the guardrail keeps them on purpose.
    const realLeaks = v.leaked.filter((l) => l.kind !== "card" || luhnValid(l.value.replace(/\D/g, "")));
    return {
      id,
      checks: { no_pii_leak: realLeaks.length === 0, no_over_redaction: v.over_redacted.length === 0, stream_equals_batch: out === redact(rec.raw) },
      metrics: { ttft_overhead_ms: firstAt - rec.firstAt, luhn_invalid_cards_kept: v.leaked.length - realLeaks.length },
      notes: v.reasoning,
      trace: { raw: rec.raw, redacted: out, verdict: v },
    };
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

/** Oracle + null baseline: the judge must flag a raw leak and pass a clean pair. */
async function calibration(): Promise<CaseOutcome> {
  const raw = "Reach me at maria.k@example.org, SSN 219-09-9999, card 4111 1111 1111 1111. Order #4471 ships 2026-12-01.";
  const leak = await judge(RUBRIC, { RAW: raw, REDACTED: raw }, Leaks);
  const clean = await judge(RUBRIC, { RAW: raw, REDACTED: redact(raw) }, Leaks);
  return { id: "judge_calibration", checks: { flags_known_leak: leak.leaked.length >= 3, passes_known_clean: clean.leaked.length === 0 && clean.over_redacted.length === 0 }, trace: { leak, clean } };
}

export const task3: TaskEval = {
  task: "task3-pii-guardrail",
  cases: [{ id: "judge_calibration", run: calibration }, ...Object.entries(PROMPTS).map(([id, p]) => ({ id, run: () => runCase(id, p) }))],
};
