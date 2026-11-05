# MCP Security Gateway: Product Spec

**Author:** hurkanakbiyik
**Date:** 2026-11-05
**Status:** In Review
**Reviewers:** Solution Architect assessment panel
**Related links:** [Technical RFC](technical-rfc.md), assessment brief Task 2

---

## 1. Summary

MCP servers expose tools that change data, and today any agent that can reach a server can call all of them. This gateway sits in front of MCP servers, reads the caller's bearer token, and blocks calls to `admin_*` tools unless the caller holds the `admin` role. Blocked calls get JSON-RPC error `-32001` and never reach the server.

## 2. Current Situation

- **What happens today:** agents connect straight to MCP servers. Each server would need its own auth code.
- **Pain points:** a viewer-level agent, or a prompt-injected one, can call `admin_reset_key`. Servers built by different teams enforce roles differently, or not at all.
- **Cost of the problem:** one unauthorized key rotation locks a customer out and opens a security incident.
- **Evidence:** the assessment brief. Prompt injection that steers agents toward privileged tools is a known attack class (OWASP LLM Top 10, LLM01 and LLM06).

## 3. Desired Situation

- Every agent request passes one checkpoint that knows who the caller is.
- Viewers keep full read access. Only admins reach admin tools. Downstream servers need no auth code of their own.

## 4. Goals & Success Metrics

- **Primary metric:** unauthorized `admin_*` calls that reach a downstream server.
  - Current: unbounded (no control).
  - Target: 0, from launch.
  - How it's measured: downstream call log in e2e tests and evals, including a prompt-injection eval.
- **Secondary metrics:** viewer read calls blocked by mistake (target 0).
- **Non-goals:** filtering `tools/list` per role, issuing tokens, rate limiting.

## 5. Scope

- **In scope:** HTTP reverse proxy for MCP Streamable HTTP, HS256 JWT verification, role extraction, `tools/call` inspection, JSON-RPC error responses, a mock downstream MCP server, tests, evals.
- **Out of scope:** OAuth 2.1 authorization server, per-tool scopes beyond the `admin_` prefix, audit storage.

## 6. Users & Scenarios

- **Who this is for:** platform teams that run MCP servers for many agents; security teams that need one enforcement point.
- **Primary scenarios:**
  - *Given* a viewer token, *when* the agent sends `tools/list`, *then* the gateway forwards it and returns the downstream answer unchanged.
  - *Given* a viewer token, *when* the agent calls `admin_reset_key`, *then* the gateway answers `{"code":-32001,"message":"Unauthorized Tool Call"}` and the downstream server sees nothing.
  - *Given* an admin token, *when* the agent calls `admin_reset_key`, *then* the call goes through.
  - *Given* no token or a forged token, *when* any request arrives, *then* the gateway answers HTTP 401.

## 7. Functional Requirements

- **T2-FR-001:** When a request arrives, the system shall read `Authorization: Bearer <token>`, verify it, and extract `role` (`admin` or `viewer`).
- **T2-FR-002:** When the token is missing, malformed, forged, expired, uses `alg` other than HS256, or carries an unknown role, the system shall answer HTTP 401 with JSON-RPC error `-32000`.
- **T2-FR-003:** When `method` is `tools/list`, the system shall forward the request to the downstream server unchanged and stream the reply back.
- **T2-FR-004:** When `method` is `tools/call` and `params.name` starts with `admin_` and the role is not `admin`, the system shall answer JSON-RPC error `-32001` "Unauthorized Tool Call" with the request's `id`, and shall not contact the downstream server.
- **T2-FR-005:** When `method` is `tools/call` and the caller is allowed, the system shall forward the request.
- **T2-FR-006:** When `params.name` is not a string, the system shall answer `-32602`.
- **T2-FR-007:** When the body is not JSON, the system shall answer `-32700`. When the envelope is invalid or the body is a batch array, it shall answer `-32600`.
- **T2-FR-008:** The system shall not forward the client's `Authorization` header or cookies downstream, and shall add `x-gateway-user` and `x-gateway-role`.
- **T2-FR-009:** When the downstream server is unreachable, the system shall answer HTTP 502 with JSON-RPC error `-32603`.

## 8. Non-Functional Requirements

- **Security:** constant-time signature compare; `alg=none` rejected; 1 MB body cap.
- **Compatibility:** works with the official MCP SDK client over Streamable HTTP, JSON and SSE replies.
- **Latency:** one JSON parse per POST; the response body streams through without buffering.

## 9. Constraints & Dependencies

- **Technical constraints already known:** MCP Streamable HTTP (2025-06-18) removed JSON-RPC batching.
- **Dependencies:** an identity provider that issues JWTs with `sub` and `role` claims.
- **Regulatory / legal / compliance constraints:** denial logs hold user id, role and tool name. No arguments are logged.

## 10. Assumptions

- Tokens are HS256 JWTs signed with a shared secret. A production deployment would use RS256 with a JWKS endpoint (RFC open question).
- The `admin_` prefix check is case-sensitive, matching MCP tool name semantics. A downstream server must not treat `Admin_reset_key` as `admin_reset_key`. [NEEDS CLARIFICATION: confirm downstream servers use exact-match tool names.]

## 11. Implementation Phases

| Phase | Scope | Target |
|---|---|---|
| Phase 1 | Prefix rule, JWT, proxy, tests, evals | 2026-11-05 |
| Phase 2 | JWKS/RS256, policy file per tool | After review |
| Phase 3 | Role-aware `tools/list` filtering, audit sink | After Phase 2 |

## 12. Risks & Open Questions

- **Risks:** viewers still see admin tools in `tools/list` (the brief asks for transparent forwarding). An agent may try them and get `-32001`; the eval checks it then tells the user it lacks permission.
- **Open questions:** should viewers see admin tools at all? Should denials feed a SIEM?

## 13. Stakeholders

- **Decision-maker:** assessment panel. **Reviewers:** security, platform. **Keep informed:** MCP server owners.

## 14. Supporting Material

- [Technical RFC](technical-rfc.md); MCP Streamable HTTP transport spec.

---

## Glossary

- **JWT:** JSON Web Token, a signed set of claims (`sub`, `role`, `exp`).
- **Streamable HTTP:** MCP transport where the client POSTs JSON-RPC and the server answers with JSON or an SSE stream.
