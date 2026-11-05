import { afterEach, describe, expect, it } from "vitest";
import { createMockLlm, type MockBehavior, type MockStats } from "../src/mocks/llm-provider.js";
import { openAiCompatible } from "../src/providers/openai-compatible.js";
import { openDb } from "../src/task4-router/db.js";
import { createRouterGateway } from "../src/task4-router/gateway.js";
import { TokenRateLimiter } from "../src/task4-router/rate-limiter.js";
import { ServerPool } from "./helpers/servers.js";
import { tmpDbPath } from "./helpers/tmpdb.js";

const pool = new ServerPool();
afterEach(() => pool.closeAll());

async function setup(primary: MockBehavior, secondary: MockBehavior = { chunks: ["from secondary"] }, limit = 50_000) {
  const pStats: MockStats = { requests: 0, aborted: 0 };
  const sStats: MockStats = { requests: 0, aborted: 0 };
  const p = openAiCompatible("primary", await pool.start(createMockLlm("primary-model", () => primary, pStats)));
  const s = openAiCompatible("secondary", await pool.start(createMockLlm("secondary-model", () => secondary, sStats)));
  const limiter = new TokenRateLimiter(openDb(tmpDbPath()), { limit });
  const url = await pool.start(createRouterGateway({ providers: [p, s], limiter, tenants: new Map([["key-a", "tenant-a"]]) }));
  return { url: url + "/v1/chat/completions", pStats, sStats, limiter };
}

const ask = (url: string, maxTokens = 100, key = "key-a") =>
  fetch(url, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ messages: [{ role: "user", content: "hello" }], max_tokens: maxTokens }) });

const LEAKS = /primary|secondary|127\.0\.0\.1|localhost|stack|Traceback|at \w+ \(|password|sk-/i;

describe("Router gateway (Task 4): fallback", () => {
  it("when the primary is healthy, then the primary serves and the secondary is not called", async () => {
    // Arrange
    const { url, sStats } = await setup({ chunks: ["from primary"] });
    // Act
    const body = await (await ask(url)).json();
    // Assert
    expect(body.choices[0].message.content).toBe("from primary");
    expect(sStats.requests).toBe(0);
  });

  it("when the primary answers 429, then the secondary serves the request", async () => {
    // Arrange
    const { url, pStats } = await setup({ status: 429 });
    // Act
    const res = await ask(url);
    // Assert
    expect(res.status).toBe(200);
    expect((await res.json()).choices[0].message.content).toBe("from secondary");
    expect(pStats.requests).toBe(1);
  });

  it("when the primary hangs, then failover happens at 3000 ms and the primary is aborted", async () => {
    // Arrange
    const { url, pStats } = await setup({ delayMs: 6000 });
    const t0 = performance.now();
    // Act
    const res = await ask(url);
    const elapsed = performance.now() - t0;
    // Assert
    expect((await res.json()).choices[0].message.content).toBe("from secondary");
    expect(elapsed).toBeGreaterThanOrEqual(2990);
    expect(elapsed).toBeLessThan(3600);
    await new Promise((r) => setTimeout(r, 50));
    expect(pStats.aborted).toBe(1); // the late primary reply can never be used
  });

  it("when the primary answers 500, then there is no failover and the client gets a sanitized 502", async () => {
    // Arrange
    const { url, sStats } = await setup({ status: 500, errorBody: "Traceback at handler (/srv/primary/app.py:42) password=hunter2 host=10.0.0.7" });
    // Act
    const res = await ask(url);
    const text = await res.text();
    // Assert
    expect(res.status).toBe(502);
    expect(JSON.parse(text)).toEqual({ error: { type: "upstream_error", message: "The model provider returned an error. Retry the request; if it keeps failing, contact support with the request_id.", request_id: expect.stringMatching(/^req_/) } });
    expect(text).not.toMatch(LEAKS);
    expect(sStats.requests).toBe(0);
  });

  it("when both providers answer 429, then the client gets a sanitized 503 and the tokens are refunded", async () => {
    // Arrange
    const { url, limiter } = await setup({ status: 429, errorBody: "primary quota exhausted for org-123" }, { status: 429 });
    // Act
    const res = await ask(url, 1000);
    const text = await res.text();
    // Assert
    expect(res.status).toBe(503);
    expect(JSON.parse(text).error.type).toBe("upstream_unavailable");
    expect(text).not.toMatch(LEAKS);
    expect(limiter.reserve("tenant-a", 50_000).ok).toBe(true); // nothing was charged
  });
});

describe("Router gateway (Task 4): rate limiting and errors", () => {
  it("when 20 requests arrive at once, then exactly the 9 that fit are admitted and the rest get 429", async () => {
    // Arrange
    const { url } = await setup({ chunks: ["ok"], delayMs: 100, totalTokens: 4_000 });
    // Each request reserves ~5,006 tokens (2 prompt + 4 overhead + 5,000). 50k / 5,006 = 9 fit.
    // Act
    const results = await Promise.all(Array.from({ length: 20 }, () => ask(url, 5_000)));
    const ok = results.filter((r) => r.status === 200).length;
    const limited = results.filter((r) => r.status === 429);
    // Assert
    expect(ok).toBe(9);
    expect(limited.length).toBe(11);
    expect(Number(limited[0]!.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await limited[0]!.json()).error.type).toBe("rate_limit_exceeded");
  });

  it("when the key is unknown or the body is bad, then it answers a standard 401 or 400", async () => {
    // Arrange
    const { url } = await setup({});
    // Act
    const unauth = await ask(url, 100, "nope");
    // Assert
    expect(unauth.status).toBe(401);
    expect((await unauth.json()).error.type).toBe("authentication_error");
    const bad = await fetch(url, { method: "POST", headers: { authorization: "Bearer key-a" }, body: "{" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { type: "invalid_request" } });
  });
});
