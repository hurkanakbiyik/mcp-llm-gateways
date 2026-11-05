import type { Server } from "node:http";
import { z } from "zod";
import { createMockLlm, type MockBehavior } from "../src/mocks/llm-provider.js";
import { anthropicProvider } from "../src/providers/anthropic.js";
import { openAiCompatible } from "../src/providers/openai-compatible.js";
import type { LlmProvider } from "../src/providers/types.js";
import { listen } from "../src/shared/listen.js";
import { openDb } from "../src/task4-router/db.js";
import { createRouterGateway } from "../src/task4-router/gateway.js";
import { TokenRateLimiter } from "../src/task4-router/rate-limiter.js";
import { MODEL, judge } from "./lib/claude.js";
import type { CaseOutcome, TaskEval } from "./lib/types.js";

// Secrets planted in upstream failures. None may reach the client.
const PLANTED = ["hunter2", "10.0.4.17", "/srv/llm-primary/app.py", "org-7781", "sk-live-abc123", "vllm/0.9.1"];
const STACK = `Traceback (most recent call last):\n  File "/srv/llm-primary/app.py", line 42\nConnectionError: db 10.0.4.17 password=hunter2 key=sk-live-abc123 server=vllm/0.9.1`;

interface Scenario { id: string; primary: MockBehavior | "anthropic"; secondary: MockBehavior | "anthropic"; key?: string; body?: string; limit?: number; warmups?: number; expectStatus: number }

const SCENARIOS: Scenario[] = [
  { id: "primary_500_stacktrace", primary: { status: 500, errorBody: STACK }, secondary: {}, expectStatus: 502 },
  { id: "both_429_org_quota", primary: { status: 429, errorBody: "quota exhausted for org-7781" }, secondary: { status: 429, errorBody: STACK }, expectStatus: 503 },
  { id: "timeout_then_500", primary: { delayMs: 4000 }, secondary: { status: 500, errorBody: STACK }, expectStatus: 502 },
  { id: "tenant_over_limit", primary: { totalTokens: 1000 }, secondary: {}, limit: 1500, warmups: 1, expectStatus: 429 },
  { id: "malformed_json", primary: {}, secondary: {}, body: "{not json", expectStatus: 400 },
  { id: "bad_api_key", primary: {}, secondary: {}, key: "sk-wrong", expectStatus: 401 },
  { id: "real_fallback_to_claude", primary: { status: 429, errorBody: STACK }, secondary: "anthropic", expectStatus: 200 },
];

const Verdict = z.object({
  leaks_internal_details: z.boolean().describe("The response exposes stack traces, file paths, IPs, hostnames, credentials, provider or vendor names, software versions, or raw upstream text."),
  actionable: z.boolean().describe("A client developer can tell what went wrong and what to do (fix the request, retry later, check the key) from status, headers and body."),
  reasoning: z.string(),
});

async function provider(name: string, b: MockBehavior | "anthropic", servers: Server[]): Promise<LlmProvider> {
  if (b === "anthropic") return anthropicProvider();
  const s = createMockLlm(name, () => b);
  servers.push(s);
  return openAiCompatible(name, await listen(s));
}

async function runScenario(sc: Scenario): Promise<CaseOutcome> {
  const servers: Server[] = [];
  try {
    const providers = [await provider("llm-primary", sc.primary, servers), await provider("llm-secondary", sc.secondary, servers)];
    const limiter = new TokenRateLimiter(openDb(":memory:"), { limit: sc.limit ?? 50_000 });
    const gw = createRouterGateway({ providers, limiter, tenants: new Map([["key-eval", "tenant-eval"]]) });
    servers.push(gw);
    const url = (await listen(gw)) + "/v1/chat/completions";
    const body = sc.body ?? JSON.stringify({ model: MODEL, max_tokens: 1000, messages: [{ role: "user", content: "Say hello in five words." }] });
    const send = () => fetch(url, { method: "POST", headers: { authorization: `Bearer ${sc.key ?? "key-eval"}` }, body });
    // Warm-up requests use up the tenant's budget so the graded request hits the limiter.
    for (let i = 0; i < (sc.warmups ?? 0); i++) await (await send()).text();
    const res = await send();
    const text = await res.text();
    const shown = `HTTP ${res.status}\nretry-after: ${res.headers.get("retry-after")}\n\n${text}`;
    const json = JSON.parse(text);
    const v = await judge("Grade this LLM gateway HTTP response that a client received.", { response: shown }, Verdict);
    const isError = res.status >= 400;
    return {
      id: sc.id,
      checks: {
        expected_status: res.status === sc.expectStatus,
        no_planted_secret: !PLANTED.some((p) => text.includes(p)),
        standard_schema: isError ? Object.keys(json).join() === "error" && Object.keys(json.error).sort().join() === "message,request_id,type" : typeof json.choices?.[0]?.message?.content === "string" && json.choices[0].message.content.length > 0,
        judge_no_leak: !v.leaks_internal_details,
        judge_actionable: !isError || v.actionable,
      },
      notes: v.reasoning,
      trace: { response: shown, verdict: v },
    };
  } finally {
    for (const s of servers) {
      s.closeAllConnections();
      s.close();
    }
  }
}

/** Null baseline: a gateway that relayed the raw upstream body must be flagged. */
async function calibration(): Promise<CaseOutcome> {
  const v = await judge("Grade this LLM gateway HTTP response that a client received.", { response: `HTTP 500\n\n${JSON.stringify({ error: STACK })}` }, Verdict);
  return { id: "judge_calibration", checks: { flags_raw_relay: v.leaks_internal_details }, trace: v };
}

export const task4: TaskEval = {
  task: "task4-router",
  cases: [{ id: "judge_calibration", run: calibration }, ...SCENARIOS.map((sc) => ({ id: sc.id, run: () => runScenario(sc) }))],
};
