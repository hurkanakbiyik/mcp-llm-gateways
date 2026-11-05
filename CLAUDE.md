# Project rules

- Follow [goldbergyoni/nodebestpractices](https://github.com/goldbergyoni/nodebestpractices). Record what applies, what deviates and why in `docs/NODE-BEST-PRACTICES.md`.
- Follow the Karpathy guidelines: simplest code that meets the requirement, no speculative features.
- Docs follow `technical-rfc-template.md` and `product-spec-template.md`; prose follows stop-slop (no em dashes, no filler).
- No file over 200 lines. Split into modules instead.
- stdout is reserved for Task 1 JSON-RPC. Log through `src/shared/log.ts` (Pino, stderr). Never `console.log`.
- Config comes from `src/*/config.ts` (Zod, fail fast). Never read `process.env` elsewhere in `src/`.
- Test names: "when <scenario>, then <expected result>", with Arrange / Act / Assert.
- Before finishing a change: `npm run verify`. Evals: `npm run eval` (key in `.env`, gitignored).
