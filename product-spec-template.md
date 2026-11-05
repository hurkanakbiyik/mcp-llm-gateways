# [Feature / Initiative Name] — Product Spec

> **For the product team filling this out:** write the *what* and the *why*. Leave the *how* (architecture, frameworks, APIs) to engineering; it goes in a separate solution document once this spec is approved. Where you're not sure, write `[NEEDS CLARIFICATION: your question]` instead of guessing. An unanswered question here is cheap. A wrong assumption an engineer or agent builds on top of is not.

**Author:**
**Date:**
**Status:** Draft / In Review / Approved
**Reviewers:**
**Related links:** (tickets, research docs, mockups, prior specs)

---

## 1. Summary

One paragraph. What is this, and why does it need to exist? A reader who stops here should still understand the shape of the problem.

## 2. Current Situation

What users or the business are dealing with today, and what it costs.

- **What happens today:** the current workflow, feature, or absence of one
- **Pain points:** where it breaks down, for whom, how often
- **Cost of the problem:** lost revenue, support load, churn risk, competitive pressure, time wasted
- **Evidence:** data, user research, support ticket patterns, analytics — link it, don't just assert it

## 3. Desired Situation

What it looks like once this ships. Describe the outcome, not the solution.

- **The change in one or two sentences**
- **What's different for the user / the business**

## 4. Goals & Success Metrics

- **Primary metric:** the one thing that must move for this to count as a success
  - Current: [baseline]
  - Target: [number + timeframe]
  - How it's measured:
- **Secondary metrics:** (optional)
- **Non-goals:** what this is explicitly not trying to fix. Just as useful as the goals — it stops scope from drifting mid-build.

## 5. Scope

- **In scope:**
- **Out of scope:**

## 6. Users & Scenarios

- **Who this is for:** persona or segment
- **Primary scenarios:** the flows that matter most, written as short stories or Given/When/Then

  Example: *Given a returning customer with items in their cart, when they open the app after 24 hours, then they see a reminder with the cart contents intact.*

## 7. Functional Requirements

Number every requirement. Write each one so it can be tested — a person or an agent should be able to check a box, not interpret intent.

Where you can, use this pattern: **When** `<trigger>`, the system **shall** `<response>`. For requirements that are always true, drop "when": the system **shall** `<response>`.

- **FR-001:** When [trigger], the system shall [response].
- **FR-002:**
- **FR-003:**

Mark anything underspecified: `FR-004: The system shall retain records for [NEEDS CLARIFICATION: retention period not specified].`

## 8. Non-Functional Requirements

Performance, security, compliance, scale, accessibility, localization — whatever applies. Give numbers where you have them ("under 200ms p95," "supports 10k concurrent users"), not adjectives ("fast," "scalable").

## 9. Constraints & Dependencies

- **Technical constraints already known:** (existing systems this has to work with, things that can't change)
- **Dependencies:** other teams, systems, or initiatives this relies on
- **Regulatory / legal / compliance constraints:**

## 10. Assumptions

Anything you're taking as given — about users, data, existing systems, timing. State it so it can be challenged instead of discovered later.

## 11. Implementation Phases

If this ships in stages, lay them out. Each phase should be independently valuable, not just a slice of the whole.

| Phase | Scope | Target |
|---|---|---|
| Phase 1 | | |
| Phase 2 | | |
| Phase 3 | | |

## 12. Risks & Open Questions

- **Risks:** what could go wrong, and what it would cost
- **Open questions:** things the team still needs to resolve before or during build

## 13. Stakeholders

Who owns what — decision-maker, reviewers, people who need to be kept in the loop.

## 14. Supporting Material

Research, competitive analysis, mockups, data exports — link, don't paste.

---

## Glossary

Any domain term someone outside this project would need explained. Skip this section if there isn't one.
