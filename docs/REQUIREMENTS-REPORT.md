# Requirements Report

**Date:** 2026-11-05. **Verified with:** `npm run verify` (typecheck, ESLint, 114/114 tests in 11 files above coverage floors, audit 0 vulnerabilities), curl runs of the Task 2, 3 and 4 entrypoints, stdio runs of Task 1, and LLM-judged evals against Claude Sonnet 5.5 ([EVAL-REPORT.md](EVAL-REPORT.md)).

Legend: **Met** = implemented and covered by a passing test or eval.

## Cross-cutting

| Requirement | Status | Evidence |
|---|---|---|
| Follow `technical-rfc-template.md` | Met | `docs/task*/technical-rfc.md`, all 14 sections, Options A/B/C + comparison, Mermaid diagrams |
| Follow `product-spec-template.md` | Met | `docs/task*/product-spec.md`, all 14 sections + glossary, numbered testable FRs, `[NEEDS CLARIFICATION]` markers |
| Full e2e tests | Met | `tests/*.e2e.test.ts`: real processes and sockets, official MCP SDK clients |
| Evals (LLM-judged) | Met | `evals/`: 4 suites, 24 cases, run on Claude Sonnet 5.5 with 3 reps. Results in [EVAL-REPORT.md](EVAL-REPORT.md) |
| Keep it simple / Karpathy | Met | `node:http`, `node:crypto` and `node:sqlite` only; 3 runtime deps (MCP SDK, Zod, Anthropic SDK) |
| Max 200 lines per file | Met | longest file: `docs/task1-mcp-server/technical-rfc.md`, 171 lines |
| Node.js best practices | Met | [NODE-BEST-PRACTICES.md](NODE-BEST-PRACTICES.md): 47 rows applied, 1 deliberate deviation (5.18), 12 rows N/A with reasons |
| Stop-slop prose | Met | no em dashes in docs; filler words reviewed |

## Task 1: MCP server

| Requirement | Status | Evidence |
|---|---|---|
| TypeScript, official `@modelcontextprotocol/sdk` | Met | SDK 1.32.2, `src/task1-mcp-server/server.ts` |
| `get_customer_record(customer_id: CUST-XXXXX)` | Met | `schemas.ts`, test `lists both tools`, `returns a customer record` |
| `trigger_refund(customer_id, amount > 0 float, reason ≥ 10)` | Met | `schemas.ts`, 10 bad-refund cases + `1e999` case |
| Strict Zod validation, reject with standard JSON-RPC codes | Met | `-32602` + `data.issues` (`server.ts:37`); unknown keys rejected (`strictObject`) |
| stdio transport | Met | `main.ts`, `stdio.ts` |
| stdout pure JSON-RPC, logs on stderr | Met | test `every stdout line is a JSON-RPC 2.0 message`, source scan test, console rebind `main.ts:8` |
| Protocol compliance | Met | `-32700`/`-32600` (SDK drops these, we fixed it in `stdio.ts`), `-32601`, unknown tool `-32602`, unknown customer as `isError` result |

Findings worth a reviewer's attention:
- `McpServer` in SDK 1.32.2 returns validation failures as `isError` tool results, not JSON-RPC errors. We use the low-level `Server` (RFC-001 section 7).
- The SDK maps a non-object `arguments` to `-32603`. A loose envelope schema routes it to `-32602` (`server.ts:16`).

## Task 2: MCP gateway

| Requirement | Status | Evidence |
|---|---|---|
| HTTP/JSON-RPC reverse proxy in Node.js | Met | `gateway.ts`, `forward.ts`, streams JSON and SSE |
| Read `Bearer <token>`, extract role | Met | HS256 JWT (`auth.ts`); 6 bad-token cases return 401 |
| `tools/list` forwarded transparently | Met | test `forwards tools/list unchanged` (SDK client) |
| `tools/call` + `admin_` + non-admin → `-32001` without downstream call | Met | `policy.ts:22`; test asserts downstream call log is empty |
| Admins can call admin tools | Met | test `lets an admin call admin_ tools` |
| Clean error handling | Met | `-32700`, `-32600` (incl. batch reject `gateway.ts:34`), `-32602`, 413, 502 |

Extra hardening: client `Authorization` and cookies are stripped before forwarding (tested).

## Task 3: Streaming PII guardrail

| Requirement | Status | Evidence |
|---|---|---|
| Route to an LLM provider and stream back | Met | `gateway.ts`; OpenAI-compatible adapter (tested with mock) and Claude adapter (`src/providers/anthropic.ts`, exercised live by the Task 3 and Task 4 evals) |
| Intercept and redact emails, SSNs, card numbers in real time | Met | `patterns.ts` (Luhn-checked cards), e2e test with PII split into 3-char chunks |
| No full-response accumulation, low TTFT | Met | adaptive hold `patterns.ts:48`; first delta under 150 ms while upstream takes about 1 s (test); memory bound test over 100k deltas |
| Efficient async chunking and buffer state | Met | `drain` backpressure `gateway.ts:19`; client disconnect aborts upstream (test) |
| Performant matching over partial text | Met | one precompiled regex with bounded quantifiers (linear, ReDoS test), O(chunk + 256) per delta; 9.3 MB/s, 2.3M deltas/s on this laptop |
| Correct over any chunking | Met | property test: 500 random texts × random splits equal whole-text redaction |

A test caught a latency bug during the build ("word0 word1" chained into one held run) and we fixed it.

## Task 4: Rate limiter + fallback router

| Requirement | Status | Evidence |
|---|---|---|
| Token-aware sliding window, 50,000 tokens/min per tenant key | Met | `rate-limiter.ts`; fake-clock tests for the limit edge and the exact slide moment |
| On-disk SQLite | Met | `db.ts` (WAL); test `persists state on disk across restarts` |
| Accurate eviction and token tracking | Met | eviction on each reserve `rate-limiter.ts:45`; commit to real usage and release on failure (tests) |
| Async concurrency | Met | `BEGIN IMMEDIATE` reservation `rate-limiter.ts:43`; 20 concurrent requests admit exactly 9 (test) |
| Failover on 429 | Met | test `fails over to the secondary on a primary 429` |
| Failover on 3000 ms timeout, race-safe | Met | `Promise.race` + abort `fallback.ts:29`; test: failover lands in 2990 to 3600 ms and the primary socket is aborted |
| Standard error payload, no stack traces or internals | Met | `errors.ts:25`; tests assert exact payload and no hostnames, paths or secrets |

## Assumptions to confirm

1. `CUST-XXXXX` = five digits.
2. 5xx from the primary does not trigger failover (the brief names only 429 and timeout).
3. SSNs count only in `NNN-NN-NNNN` form; Luhn-invalid card-like numbers stay visible.
4. Tokens of a request that failed on every provider are refunded to the tenant.
5. HS256 shared-secret JWTs for Task 2 (RS256/JWKS listed as Phase 2).

## Gaps closed after the first review

- **Multi-process SQLite:** `tests/task4-multiprocess.test.ts` runs 4 processes against one file; together they admit exactly the 50k budget. The test found a real bug: concurrent startup failed with "database is locked" during the WAL switch. `openDb` now sets `busy_timeout` first and retries setup on `SQLITE_BUSY` (20/20 stress runs pass).
- **Secrets in logs:** `UpstreamError.detail` (the raw upstream body) is non-enumerable, so `{ err }` logging skips it; it is logged only at `debug` (`tests/log-hygiene.test.ts`).
- **Dev dependency advisory:** `minimatch` overridden to 11.0.4; `npm audit` reports 0 vulnerabilities for all dependencies.
- **Judge self-preference:** evals re-run with Claude Opus 5.5 as an independent judge ([EVAL-REPORT.md](EVAL-REPORT.md)).
