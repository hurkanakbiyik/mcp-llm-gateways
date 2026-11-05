# Node.js Best Practices: Compliance

Source: [goldbergyoni/nodebestpractices](https://github.com/goldbergyoni/nodebestpractices). We checked each section against this project. "N/A" items depend on a framework, a database layer or Docker image that this project does not have.

`npm run verify` runs typecheck, lint, tests with coverage floors, and a runtime dependency audit.

## Applied

| # | Practice | How this project does it |
|---|---|---|
| 1.1 | Structure by components | One folder per task (`src/task1-*` .. `src/task4-*`); shared code in `src/shared`, `src/providers` |
| 1.4 | Validated, typed config | `src/*/config.ts` parse env with Zod at startup; defaults for each key; `.env` read by `node --env-file-if-exists` |
| 1.6 | TypeScript, used plainly | Types for contracts; no decorators or class hierarchies |
| 2.1 | async/await | All async code |
| 2.2 | Extend `Error` | `UpstreamError`, `GatewayError`, `ConfigError`, `BodyTooLargeError` |
| 2.3 | Operational vs catastrophic errors | Operational errors map to typed responses; unknown errors go to the process handler |
| 2.6 | Exit on unknown errors | `src/shared/lifecycle.ts`: log fatal, run closers, exit 1; the supervisor restarts |
| 2.7 | Mature logger | Pino (`src/shared/log.ts`), JSON, levels via `LOG_LEVEL` |
| 2.8 | Test error flows | Every gateway has tests for 4xx, 5xx, timeouts and malformed input |
| 2.10 | Catch unhandled rejections | `lifecycle.ts`; lint rule `no-floating-promises` |
| 2.11 | Fail fast with a validation library | Zod for tool input, request bodies and config |
| 2.12 | `return await` | Lint rule `@typescript-eslint/return-await` |
| 2.13 | Stream `error` events | `forward.ts` destroys the response on upstream stream errors |
| 3.1, 3.2 | ESLint + Node plugins | `eslint.config.mjs`: typescript-eslint, eslint-plugin-n, eslint-plugin-security |
| 3.7, 3.10 | `const`, `===` | Lint rules `prefer-const`, `eqeqeq` |
| 4.1 | API/component tests | e2e suites start real servers on real sockets |
| 4.2 | 3-part test names | `describe` = unit; test = "when <scenario>, then <expected result>" |
| 4.3 | AAA pattern | Arrange / Act / Assert markers in multi-step tests |
| 4.4 | One Node version | `.nvmrc` (24), `engines`, `engine-strict=true` |
| 4.5 | Data per test | Fresh SQLite file, fresh servers and call logs per test |
| 4.7 | Coverage with a floor | `npm run test:coverage`; build fails below the thresholds in `vitest.config.ts` |
| 4.10 | Mock external HTTP | `src/mocks/llm-provider.ts`, mock downstream MCP server |
| 4.12 | Fixed port in prod, random in tests | `PORT` config; tests listen on port 0 |
| 4.13 | Test the five outcomes | Responses, state (SQLite rows), external calls (mock counters), errors, logs (stdio test) |
| 5.4 | Lock dependencies | `package-lock.json`, exact versions, `.npmrc save-exact=true` |
| 5.7 | Maintenance endpoint | `GET /healthz` on the Task 2, 3 and 4 gateways |
| 5.12 | Stateless | Gateways keep no in-process state; limiter state is in SQLite |
| 5.13, 6.7 | Vulnerability scan | `npm run audit`; 0 vulnerabilities in all dependencies |
| 5.14 | Transaction id | Task 4 tags every log line and error body with `request_id` |
| 5.17 | LTS Node | Node 24 LTS |
| 5.19 | `npm ci` | README install step |
| 6.1 | Security lint rules | eslint-plugin-security |
| 6.2 | Limit requests | Task 4 token rate limiter per tenant |
| 6.3 | Secrets out of code | `.env` is gitignored; `JWT_SECRET` required in production |
| 6.6 | Security headers | `x-content-type-options: nosniff` on JSON responses (APIs, no HTML) |
| 6.10 | Validate JSON schemas | Zod on every request body |
| 6.14 | Limit payload size | 1 MB body cap, HTTP 413 |
| 6.15 | No `eval` | Lint rule `no-eval` |
| 6.16 | Safe regex | PII regex quantifiers bounded; test proves 20 KB inputs stay linear (was ~620 ms, now ~5 ms) |
| 6.19 | Child processes | Only tests and evals spawn processes, with fixed commands |
| 6.20 | Hide error details | Task 4 error mapper; Task 3 generic SSE error |
| 6.23 | Crash handling | Input validated before work; fatal errors logged at `fatal` level |
| 6.27 | `node:` protocol | Lint rule `n/prefer-node-protocol` |
| 7.1 | Don't block the event loop | Sync SQLite calls are sub-millisecond; regex work bounded per delta |
| 7.2 | Native over user-land | `node:http`, `node:crypto`, `node:sqlite`, global `fetch` |
| 8.2 | Start with `node` | `npm run build`, then `node dist/<task>/main.js` |
| 8.6 | Graceful shutdown | SIGTERM/SIGINT close servers (5 s grace for SSE) and the DB, then exit 0 (tested) |

## Deliberate deviations

| # | Practice | Why we deviate |
|---|---|---|
| 5.18 | Log to stdout | Task 1 speaks JSON-RPC on stdout, so all services log to stderr. Runtimes capture stderr the same way. |

## Not applicable

| # | Practice | Reason |
|---|---|---|
| 1.2 | 3-tier layering with a web framework | No framework; each service is one small handler |
| 1.3 | Publish shared utils as packages | One repo, four services |
| 1.5 | Choose a framework | `node:http` is enough for four endpoints |
| 2.4 | Central error handler, not middleware | Each service has one handler, which is the central place |
| 2.5 | OpenAPI docs | Contracts live in the RFCs; no public API yet |
| 2.9, 5.1, 5.8 | APM / monitoring | No production deployment |
| 5.3 | Reverse proxy for TLS and gzip | Deployment concern |
| 5.5, 5.6 | Process manager, all CPU cores | Container runtime's job |
| 6.4 | ORM against injection | SQLite access uses prepared statements only |
| 6.8, 6.11, 6.12, 6.22 | Passwords, JWT blocklist, brute force, sessions | No user accounts or sessions (token issuing is out of scope) |
| 6.9, 6.24 | Escape HTML, unsafe redirects | JSON APIs, no HTML, no redirects |
| 6.13, 8.x | Docker image practices | No Dockerfile in this project |

## Dependency advisories

`npm audit` reports 0 vulnerabilities, dev dependencies included. ESLint's toolchain pulled `minimatch` 10.x (GHSA-g3hv-75wg-m249); `package.json` `overrides` pins the patched 11.0.4, and lint still runs every rule.
