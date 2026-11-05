# Customer Support MCP Server: Product Spec

**Author:** hurkanakbiyik
**Date:** 2026-11-05
**Status:** In Review
**Reviewers:** Solution Architect assessment panel
**Related links:** [Technical RFC](technical-rfc.md), assessment brief Task 1

---

## 1. Summary

AI agents need a safe way to read customer records and issue refunds. This MCP server gives them two tools, `get_customer_record` and `trigger_refund`, and refuses any call whose input breaks the contract. A refund with a negative amount or a vague reason never reaches the billing system. The agent gets a precise, machine-readable error and can fix its call or ask the user.

## 2. Current Situation

- **What happens today:** agents call support backends through ad-hoc scripts. Each script validates input its own way, or not at all.
- **Pain points:** a model that hallucinates `amount: -40` or `customer_id: "12345"` can trigger a bad write. When a script fails, the agent sees free text and guesses at the cause.
- **Cost of the problem:** wrong refunds cost money and need manual reversal. Vague errors make agents retry blindly, which burns tokens and time.
- **Evidence:** the assessment brief (Task 1). We also found that the SDK's high-level `McpServer` reports validation failures as tool results, not JSON-RPC errors (RFC section 6).

## 3. Desired Situation

- Agents call two well-typed tools. The server rejects malformed input before any business logic runs, with JSON-RPC error `-32602` and a list of the fields that failed.
- Operators read server logs on stderr. The JSON-RPC stream on stdout stays clean, so no client ever sees a corrupted frame.

## 4. Goals & Success Metrics

- **Primary metric:** share of malformed tool calls rejected with `-32602` before execution.
  - Current: no baseline (new server).
  - Target: 100% of the cases in the e2e suite, from launch.
  - How it's measured: `tests/task1-mcp-server.e2e.test.ts`, 24 malformed-input cases.
- **Secondary metrics:** stdout purity (100% of lines parse as JSON-RPC 2.0); agent honesty in LLM-judged evals (no invented refunds or reasons).
- **Non-goals:** authentication, persistence, a real billing integration, HTTP transport.

## 5. Scope

- **In scope:** two tools, Zod schemas, stdio transport, JSON-RPC error mapping, stderr logging, e2e tests, LLM-judged agent evals.
- **Out of scope:** auth (Task 2 covers it at the gateway), refund limits per customer, idempotency keys, a database.

## 6. Users & Scenarios

- **Who this is for:** AI support agents (MCP clients such as Claude Desktop or a custom agent loop) and the engineers who operate them.
- **Primary scenarios:**
  - *Given* customer `CUST-10001` exists, *when* the agent calls `get_customer_record`, *then* it receives the record as text and `structuredContent`.
  - *Given* a valid id, amount and reason, *when* the agent calls `trigger_refund`, *then* the server returns a refund id `RF-XXXXXX`.
  - *Given* the agent sends `amount: -40`, *when* the call arrives, *then* the server answers `-32602` with `data.issues[0].path = "amount"` and creates no refund.
  - *Given* the id `CUST-99999` does not exist, *when* the agent looks it up, *then* it gets a tool result with `isError: true` it can relay to the user.

## 7. Functional Requirements

- **T1-FR-001:** The system shall expose `get_customer_record` with input `customer_id` matching `^CUST-\d{5}$`.
- **T1-FR-002:** The system shall expose `trigger_refund` with inputs `customer_id`, `amount` (finite number > 0) and `reason` (string of 10 to 1000 characters after trimming).
- **T1-FR-003:** When a tool call fails schema validation, the system shall return JSON-RPC error `-32602` with `data.issues` listing each failing field, and shall not execute the tool.
- **T1-FR-004:** When a tool call carries unknown fields, the system shall reject it with `-32602`.
- **T1-FR-005:** When a client names an unknown tool, the system shall return `-32602`.
- **T1-FR-006:** When a line on stdin is not valid JSON, the system shall answer `-32700` with `id: null`. When the envelope is invalid, it shall answer `-32600`.
- **T1-FR-007:** When a client calls an unknown method, the system shall return `-32601`.
- **T1-FR-008:** When input is valid but the customer does not exist, the system shall return a tool result with `isError: true`.
- **T1-FR-009:** The system shall write only JSON-RPC messages to stdout and all logs to stderr.
- **T1-FR-010:** The system shall list both tools via `tools/list` with JSON Schemas generated from the same Zod schemas that validate calls.

## 8. Non-Functional Requirements

- **Protocol:** MCP over stdio, JSON-RPC 2.0, newline-delimited. Works with the official SDK client (verified in tests).
- **Reliability:** an uncaught exception is logged to stderr and does not write to stdout.
- **Performance:** validation adds under 1 ms per call (Zod on a 3-field object).
- **Security:** no string-to-number coercion; `1e999` (parsed as `Infinity`) is rejected.

## 9. Constraints & Dependencies

- **Technical constraints already known:** official SDK `@modelcontextprotocol/sdk` 1.32.2 and Zod 4. Node.js 22.13 or later.
- **Dependencies:** none at runtime beyond the SDK and Zod.
- **Regulatory / legal / compliance constraints:** customer records hold PII (email). Logs record tool names and validation issues only, never record contents.

## 10. Assumptions

- `CUST-XXXXX` means `CUST-` plus exactly five digits. [NEEDS CLARIFICATION: confirm X is a digit and not any alphanumeric.]
- "Positive float" accepts integers too, since JSON has one number type.
- A reason of ten spaces carries no information, so we trim before checking the minimum length.
- The 1000-character cap on `reason` is ours. The brief gives only a minimum.

## 11. Implementation Phases

| Phase | Scope | Target |
|---|---|---|
| Phase 1 | Two tools, validation, stdio, tests, evals (this delivery) | 2026-11-05 |
| Phase 2 | Real CRM/billing adapters behind the same schemas | After review |
| Phase 3 | Idempotency keys and per-customer refund caps | After Phase 2 |

## 12. Risks & Open Questions

- **Risks:** the MCP spec revision 2025-11-25 recommends returning input validation errors as tool results so the model can self-correct. The brief asks for JSON-RPC errors. We follow the brief and keep the field-level `data.issues` so agents can still self-correct (the eval checks this).
- **Open questions:** should refunds above a threshold need human approval? Should the server enforce `amount <= balance`?

## 13. Stakeholders

- **Decision-maker:** assessment panel.
- **Reviewers:** platform engineering, support operations.
- **Keep informed:** security (PII handling).

## 14. Supporting Material

- [Technical RFC](technical-rfc.md)
- MCP specification, tools and error handling: https://modelcontextprotocol.io/specification

---

## Glossary

- **MCP:** Model Context Protocol. A JSON-RPC protocol that lets AI clients call tools on servers.
- **stdio transport:** the client spawns the server and exchanges newline-delimited JSON-RPC over stdin and stdout.
- **`-32602`:** JSON-RPC "Invalid params".
