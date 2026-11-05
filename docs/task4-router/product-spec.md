# Rate-Limited Model Router with Fallback: Product Spec

**Author:** hurkanakbiyik
**Date:** 2026-11-05
**Status:** In Review
**Reviewers:** Solution Architect assessment panel
**Related links:** [Technical RFC](technical-rfc.md), assessment brief Task 4

---

## 1. Summary

One tenant can burn a shared LLM budget, and one provider outage can take every app down. This router caps each tenant at 50,000 tokens per minute and moves a request to a backup provider when the primary answers 429 or takes longer than 3 seconds. Every error a client sees uses one format with no upstream internals.

## 2. Current Situation

- **What happens today:** apps call one provider directly with a shared key.
- **Pain points:** a noisy tenant triggers provider 429s for everyone; a slow primary leaves users waiting; raw upstream errors (stack traces, hostnames, org ids) reach clients.
- **Cost of the problem:** outages during provider incidents; leaked internals help attackers map the stack.
- **Evidence:** the assessment brief.

## 3. Desired Situation

- Each tenant gets a fair, exact per-minute token budget that survives restarts.
- A provider 429 or timeout costs the user about 3 seconds at most, not an error.

## 4. Goals & Success Metrics

- **Primary metric:** requests served when the primary is rate limited or slow.
  - Current: 0% (no fallback).
  - Target: 100% while the secondary is healthy.
  - How it's measured: e2e tests (429 and 3000 ms timeout paths) and the eval `real_fallback_to_claude`.
- **Secondary metrics:** tokens admitted per tenant per 60 s never above 50,000 (concurrency test); 0 planted secrets in error bodies (eval).
- **Non-goals:** streaming completions, cost-based routing, retries on the same provider.

## 5. Scope

- **In scope:** `POST /v1/chat/completions` (non-streaming), tenant API keys, token-aware sliding window on on-disk SQLite, 3000 ms timeout, failover, standard error payload, tests, evals.
- **Out of scope:** provider health scoring, circuit breakers, billing export.

## 6. Users & Scenarios

- **Who this is for:** multi-tenant platforms that resell or share LLM capacity.
- **Primary scenarios:**
  - *Given* the primary returns 429, *when* a request arrives, *then* the secondary serves it.
  - *Given* the primary hangs, *when* 3000 ms pass, *then* the router cancels it and the secondary serves the request.
  - *Given* a tenant used 48,000 tokens in the last minute, *when* it sends a request estimated at 5,000, *then* it gets HTTP 429 with `Retry-After`.
  - *Given* the primary returns 500 with a stack trace, *when* the client reads the error, *then* it sees `{"error":{"type":"upstream_error","message":...,"request_id":...}}` and nothing else.

## 7. Functional Requirements

- **T4-FR-001:** The system shall authenticate each request with `Authorization: Bearer <tenant api key>` and map it to a tenant id; unknown keys get 401.
- **T4-FR-002:** When a request arrives, the system shall reserve its estimated tokens (prompt chars / 4 + 4 per message + `max_tokens`, default 1024) against the tenant's last 60 s of usage.
- **T4-FR-003:** When the reservation would exceed 50,000 tokens in the window, the system shall answer 429 `rate_limit_exceeded` with `Retry-After` set to when enough usage expires.
- **T4-FR-004:** When one request alone exceeds the limit, the system shall answer 400 `invalid_request`.
- **T4-FR-005:** When a request succeeds, the system shall replace the estimate with the provider-reported `total_tokens`.
- **T4-FR-006:** When all providers fail, the system shall release the reservation.
- **T4-FR-007:** When the primary returns 429 or does not answer within 3000 ms, the system shall send the request to the secondary.
- **T4-FR-008:** When the primary times out, the system shall abort the primary HTTP request, so a late reply cannot be used.
- **T4-FR-009:** When the primary fails another way (5xx, 4xx), the system shall not fail over and shall answer 502.
- **T4-FR-010:** The system shall return every error as `{"error":{"type","message","request_id"}}` with a fixed message per type, and log the real cause to stderr under the same `request_id`.
- **T4-FR-011:** The system shall store rate-limit state in an on-disk SQLite file and evict rows older than the window on every reservation.

## 8. Non-Functional Requirements

- **Correctness under concurrency:** 20 parallel requests against a 50k budget admit exactly as many as fit (test: 9 of 20 at 5,006 tokens each).
- **Timeout precision:** failover between 3000 and 3600 ms (test).
- **Durability:** usage survives a process restart (test).

## 9. Constraints & Dependencies

- **Technical constraints already known:** SQLite on disk (brief). We use Node's built-in `node:sqlite`, no native addon.
- **Dependencies:** two providers. Mocks in tests; Claude via SDK or any OpenAI-compatible URL in production.
- **Regulatory / legal / compliance constraints:** logs hold tenant ids, not API keys.

## 10. Assumptions

- 5xx should not fail over, since the brief names only 429 and timeout. [NEEDS CLARIFICATION: include 5xx and connection errors in failover?]
- Tokens of a failed request are refunded to the tenant, even if the timed-out primary did some work.
- A single gateway instance or several on one host sharing the SQLite file. Multi-host needs a shared store (RFC).

## 11. Implementation Phases

| Phase | Scope | Target |
|---|---|---|
| Phase 1 | Limiter, failover, error sanitizer | 2026-11-05 |
| Phase 2 | Streaming completions, 5xx policy, circuit breaker | After review |
| Phase 3 | Redis or Postgres limiter for multi-host | After Phase 2 |

## 12. Risks & Open Questions

- **Risks:** the char/4 estimate is off for code and non-English text. The commit step corrects usage after each response, so drift stays within one request.
- **Open questions:** charge tenants for timed-out primary work? Per-tenant custom limits?

## 13. Stakeholders

- **Decision-maker:** assessment panel. **Reviewers:** platform, finance (usage). **Keep informed:** tenant-facing support.

## 14. Supporting Material

- [Technical RFC](technical-rfc.md)

---

## Glossary

- **Sliding window:** usage counted over the last 60 s from now, not per calendar minute.
- **Failover:** sending the same request to the backup provider.
