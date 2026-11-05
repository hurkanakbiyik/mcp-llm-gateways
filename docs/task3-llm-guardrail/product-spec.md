# LLM Streaming PII Guardrail: Product Spec

**Author:** hurkanakbiyik
**Date:** 2026-11-05
**Status:** In Review
**Reviewers:** Solution Architect assessment panel
**Related links:** [Technical RFC](technical-rfc.md), assessment brief Task 3

---

## 1. Summary

LLM responses sometimes contain emails, Social Security numbers or card numbers, copied from context or made up. This gateway streams model output to the client and replaces those values with `[REDACTED]` as the tokens flow. Users still see the first words almost at once, because the gateway holds back only the last partial word that might turn into PII.

## 2. Current Situation

- **What happens today:** apps either stream raw model output (fast, unsafe) or wait for the full response and scan it (safe, slow).
- **Pain points:** waiting for the full response pushes time to first token from about one second to the full generation time, often 10 to 30 seconds. Raw streaming leaks PII to screens and logs.
- **Cost of the problem:** PII exposure carries regulatory exposure (GDPR, PCI DSS for card numbers). Slow responses hurt user experience.
- **Evidence:** the assessment brief. PCI DSS forbids displaying full card numbers.

## 3. Desired Situation

- In-scope PII does not leave the gateway, even when a token boundary splits it (`john.d` + `oe@exa` + `mple.com`).
- Time to first token through the gateway stays within one upstream token of the direct provider.

## 4. Goals & Success Metrics

- **Primary metric:** in-scope PII values that reach the client.
  - Current: all of them (no guardrail).
  - Target: 0 in tests and in the real-model eval.
  - How it's measured: e2e tests, a 500-case split-invariance property test, and an LLM judge comparing raw vs redacted Claude output.
- **Secondary metrics:** TTFT overhead (target: one upstream chunk interval); memory per stream (target: bounded by a 256-char window, independent of response length); over-redaction of non-PII (target 0 in evals).
- **Non-goals:** names, phone numbers, postal addresses; redacting the prompt; ML-based PII detection.

## 5. Scope

- **In scope:** `POST /v1/chat/completions` streaming endpoint, OpenAI-compatible and Anthropic (Claude) provider adapters, streaming redactor, tests, evals.
- **Out of scope:** non-streaming mode, tool-call deltas, per-tenant redaction policies.

## 6. Users & Scenarios

- **Who this is for:** product teams that embed LLM chat; compliance teams that must show PII controls.
- **Primary scenarios:**
  - *Given* the model streams `Card 4111 11` then `11 1111 1111`, *when* the gateway relays it, *then* the client receives `Card [REDACTED]`.
  - *Given* plain prose, *when* tokens stream in, *then* each word reaches the client as soon as the next token starts.
  - *Given* the client closes the connection, *when* the gateway notices, *then* it cancels the upstream request.

## 7. Functional Requirements

- **T3-FR-001:** When a client posts a chat request, the system shall route it to the configured provider and stream the reply as SSE `chat.completion.chunk` events ending with `data: [DONE]`.
- **T3-FR-002:** The system shall replace email addresses, SSNs in `NNN-NN-NNNN` form, and Luhn-valid 13 to 19 digit card numbers (plain, space or dash grouped) with `[REDACTED]`.
- **T3-FR-003:** When PII spans two or more upstream chunks, the system shall still redact it.
- **T3-FR-004:** The system shall hold back at most 256 characters plus one delta, whatever the response length.
- **T3-FR-005:** When the client disconnects, the system shall abort the upstream request.
- **T3-FR-006:** When the upstream fails mid-stream, the system shall flush the held text through the redactor and send a generic SSE error event with no upstream detail.
- **T3-FR-007:** When the request body is invalid, the system shall answer HTTP 400 before contacting the provider.

## 8. Non-Functional Requirements

- **Latency:** first content delta within about one upstream token interval (e2e test: under 150 ms when upstream ticks every 25 ms).
- **Throughput:** redactor processes over 1 MB of token-sized deltas per second on a laptop (unit test bound).
- **Memory:** O(256 chars) per stream for the redactor; backpressure via `drain`.

## 9. Constraints & Dependencies

- **Technical constraints already known:** regex detection only; no network calls in the hot path.
- **Dependencies:** an upstream provider. Claude via `@anthropic-ai/sdk`, or any OpenAI-compatible endpoint.
- **Regulatory / legal / compliance constraints:** PCI DSS (card display), GDPR (email as personal data).

## 10. Assumptions

- Luhn-invalid 16-digit numbers are not real cards and stay visible (keeps order and tracking numbers readable).
- Emails longer than 256 characters do not occur in practice (RFC 5321 caps addresses at 254).
- SSNs appear with dashes. [NEEDS CLARIFICATION: should 9 bare digits count as an SSN? It would also catch many order ids.]

## 11. Implementation Phases

| Phase | Scope | Target |
|---|---|---|
| Phase 1 | Email/SSN/card streaming redaction, two adapters | 2026-11-05 |
| Phase 2 | Phone, IBAN, configurable patterns per tenant | After review |
| Phase 3 | Prompt-side redaction and audit counters | After Phase 2 |

## 12. Risks & Open Questions

- **Risks:** regex misses PII written in words ("jane at example dot com"). The LLM-judged eval looks for exactly these misses.
- **Open questions:** should the gateway count redactions per response for audit? Redact before or after logging?

## 13. Stakeholders

- **Decision-maker:** assessment panel. **Reviewers:** security, compliance. **Keep informed:** client app teams.

## 14. Supporting Material

- [Technical RFC](technical-rfc.md)

---

## Glossary

- **TTFT:** time to first token, from request sent to first content byte received.
- **Luhn:** checksum all real card numbers satisfy.
- **SSE:** Server-Sent Events, `data: ...\n\n` framed HTTP streaming.
