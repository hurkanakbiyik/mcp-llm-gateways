import { afterAll, describe, expect, it } from "vitest";
import { createMockLlm, type MockBehavior, type MockStats } from "../src/mocks/llm-provider.js";
import { openAiCompatible } from "../src/providers/openai-compatible.js";
import { sseData } from "../src/providers/sse.js";
import { createGuardrailGateway } from "../src/task3-llm-guardrail/gateway.js";
import { ServerPool } from "./helpers/servers.js";

const pool = new ServerPool();
afterAll(() => pool.closeAll());

async function gatewayFor(behavior: MockBehavior, stats?: MockStats): Promise<string> {
  const upstream = await pool.start(createMockLlm("mock", () => behavior, stats));
  return (await pool.start(createGuardrailGateway(openAiCompatible("mock", upstream)))) + "/v1/chat/completions";
}

const ask = (url: string, signal?: AbortSignal) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }), signal });

/** Reads the gateway SSE stream; records when the first content delta arrived. */
async function collect(res: Response, t0: number) {
  let text = "";
  let firstAt = -1;
  const events: any[] = [];
  for await (const data of sseData(res.body!)) {
    if (data === "[DONE]") break;
    const ev = JSON.parse(data);
    events.push(ev);
    const delta = ev.choices?.[0]?.delta?.content;
    if (delta) {
      if (firstAt < 0) firstAt = performance.now() - t0;
      text += delta;
    }
  }
  return { text, firstAt, total: performance.now() - t0, events };
}

describe("PII guardrail gateway (Task 3)", () => {
  it("when PII is split across upstream chunks, then the client gets it redacted and the rest intact", async () => {
    // Arrange
    const text = "Hi Jane, your email jane.roe@example.com and SSN 078-05-1120 are on file. Card 4111 1111 1111 1111 was charged.";
    const url = await gatewayFor({ chunks: text.match(/.{1,3}/g)!, delayMs: 1 });
    // Act
    const { text: out } = await collect(await ask(url), performance.now());
    // Assert
    expect(out).toBe("Hi Jane, your email [REDACTED] and SSN [REDACTED] are on file. Card [REDACTED] was charged.");
  });

  it("when the upstream streams slowly, then the first token reaches the client long before the end", async () => {
    // Arrange
    const chunks = Array.from({ length: 40 }, (_, i) => `word${i} `);
    const url = await gatewayFor({ chunks, delayMs: 25 });
    // Act
    const { firstAt, total } = await collect(await ask(url), performance.now());
    // Upstream takes ~1000 ms. The redactor holds one partial word, so the
    // first delta should land about two upstream ticks (~50 ms) in.
    // Assert
    expect(firstAt).toBeLessThan(150);
    expect(total).toBeGreaterThan(900);
  });

  it("when the client disconnects, then the upstream request is aborted", async () => {
    // Arrange
    const stats: MockStats = { requests: 0, aborted: 0 };
    const url = await gatewayFor({ chunks: Array(200).fill("tick "), delayMs: 20 }, stats);
    const ac = new AbortController();
    // Act
    const res = await ask(url, ac.signal);
    const reader = res.body!.getReader();
    await reader.read();
    ac.abort();
    await new Promise((r) => setTimeout(r, 150));
    // Assert
    expect(stats.aborted).toBe(1);
  });

  it("when the upstream fails, then the client gets a generic SSE error event with no upstream detail", async () => {
    // Arrange
    const url = await gatewayFor({ status: 500, errorBody: "Traceback: internal-db-7.prod:5432 password=hunter2" });
    // Act
    const { events } = await collect(await ask(url), performance.now());
    // Assert
    expect(events.at(-1)).toEqual({ error: { type: "upstream_error", message: "The model provider failed mid-stream. Retry the request." } });
    expect(JSON.stringify(events)).not.toContain("hunter2");
  });

  it("when the request body is invalid, then it answers 400", async () => {
    // Arrange
    const url = await gatewayFor({});
    // Act
    const res = await fetch(url, { method: "POST", body: JSON.stringify({ messages: [] }) });
    // Assert
    expect(res.status).toBe(400);
  });
});
