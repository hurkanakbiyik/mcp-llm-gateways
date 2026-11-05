# MCP and LLM Gateways: Solution Architect Assessment

Four small TypeScript services, one per assessment task, with e2e tests and LLM-judged evals.

| Task | What it is | Code | Docs |
|---|---|---|---|
| 1 | Stdio MCP server, `get_customer_record` + `trigger_refund`, Zod validation, JSON-RPC errors | `src/task1-mcp-server` | [spec](docs/task1-mcp-server/product-spec.md), [RFC](docs/task1-mcp-server/technical-rfc.md) |
| 2 | MCP security gateway: JWT role, `admin_*` tool authorization, `-32001` | `src/task2-mcp-gateway` | [spec](docs/task2-mcp-gateway/product-spec.md), [RFC](docs/task2-mcp-gateway/technical-rfc.md) |
| 3 | LLM gateway with streaming PII redaction | `src/task3-llm-guardrail` | [spec](docs/task3-llm-guardrail/product-spec.md), [RFC](docs/task3-llm-guardrail/technical-rfc.md) |
| 4 | Token rate limiter (SQLite) + 429/timeout model fallback | `src/task4-router` | [spec](docs/task4-router/product-spec.md), [RFC](docs/task4-router/technical-rfc.md) |

Shared code: `src/shared` (stderr logger, JSON-RPC and HTTP helpers), `src/providers` (OpenAI-compatible and Claude adapters), `src/mocks` (fake LLM provider). Reports: [requirements check](docs/REQUIREMENTS-REPORT.md), [eval results](docs/EVAL-REPORT.md), [Node.js best practices compliance](docs/NODE-BEST-PRACTICES.md).

## Setup

Node.js 24 LTS (`.nvmrc`; 22.13 is the minimum for built-in `node:sqlite`).

```bash
nvm use
npm ci
npm run verify      # typecheck + lint + 114 tests with coverage floors + runtime audit
```

| Script | What it does |
|---|---|
| `npm test` | Unit and e2e tests (Vitest) |
| `npm run test:coverage` | Tests with v8 coverage; fails under the floors in `vitest.config.ts` |
| `npm run lint` | ESLint with typescript-eslint, eslint-plugin-n, eslint-plugin-security |
| `npm run audit` | `npm audit` on runtime dependencies |
| `npm run build` | Compile to `dist/`; run in production with `node dist/<task>/main.js` |
| `npm run eval` | LLM-judged evals (needs a key in `.env`) |

## Run

```bash
# Task 1: MCP server on stdio (point any MCP client at it)
npm run task1:server

# Task 2: gateway on :8080 plus a mock downstream MCP server; prints dev admin/viewer tokens to stderr
npm run task2:gateway
# DOWNSTREAM_URL=http://host/mcp JWT_SECRET=... to front a real server

# Task 3: PII guardrail on :8081 (mock provider by default)
npm run task3:gateway
curl -N localhost:8081/v1/chat/completions -d '{"messages":[{"role":"user","content":"hi"}]}'
# LLM_PROVIDER=anthropic (Claude) or LLM_PROVIDER=openai UPSTREAM_URL=... for a real provider

# Task 4: router on :8082; mock primary always 429s, mock secondary answers
npm run task4:gateway
curl localhost:8082/v1/chat/completions -H 'authorization: Bearer dev-key' -d '{"messages":[{"role":"user","content":"hi"}]}'
# PRIMARY_URL / SECONDARY_URL (OpenAI-compatible, or "anthropic"), TENANT_KEYS="key:tenant,...",
# TOKENS_PER_MINUTE (default 50000), DB_PATH (default data/gateway.sqlite)
```

All logs are Pino JSON lines on stderr (`LOG_LEVEL`, or `LOG_SILENT=1` to mute). Config is validated at startup; a bad value stops the process with a readable error. Each HTTP service answers `GET /healthz` and shuts down cleanly on SIGTERM.

## Evals (LLM-judged, needs Claude credentials)

Put your key in `.env` (gitignored): `ANTHROPIC_API_KEY=sk-ant-...`.

```bash
npm run eval                          # all four tasks, 1 rep
npm run eval -- --only task3 --reps 3 # one task, 3 reps
EVAL_MODEL=claude-sonnet-5-5 EVAL_JUDGE_MODEL=claude-sonnet-5-5 npm run eval   # cheaper run
```

Latest results ([docs/EVAL-REPORT.md](docs/EVAL-REPORT.md)): Sonnet 5.5 as the agent, 3 reps per case: 72/72 with a Sonnet judge, 71/71 scored with an independent Opus judge. In the prompt-injection case the model did call the admin tool, and the gateway blocked it every time.

- Model under test and judge: `claude-opus-5-5` (override with `EVAL_MODEL`, `EVAL_JUDGE_MODEL`).
- Task 1 and 2: Claude acts as a support agent over MCP (stdio, and through the gateway with viewer/admin tokens, including a prompt-injection case). Hard checks read the server's real state; the judge grades honesty and how the agent explains denials.
- Task 3: Claude generates fictional PII through the guardrail. The judge compares raw vs redacted text for leaks and over-redaction. Also checks stream output equals whole-text redaction and reports TTFT overhead.
- Task 4: upstream failures carry planted secrets; checks status, schema and planted strings, and the judge looks for any other leak. One case fails over from a 429 primary to real Claude.
- Tasks 3 and 4 include judge calibration cases (a known leak must be flagged, a known-clean output must pass).
- Results go to `evals/results/<timestamp>/` (results, infra errors kept apart from scores, full traces). The runner prints the token count and estimated cost (a full run makes roughly 45 to 80 Claude calls, depending on agent turns).

## Project rules

See [CLAUDE.md](CLAUDE.md). In short: Node.js best practices, no file over 200 lines, nothing on stdout except the Task 1 JSON-RPC stream.
