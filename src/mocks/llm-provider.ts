import { createServer, type Server } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { readBody, sendJson } from "../shared/http.js";

/** What the mock should do for one request. */
export interface MockBehavior {
  /** Text pieces to emit. Streaming sends one SSE event per piece. */
  chunks?: string[];
  /** Delay before each chunk (stream) or before the reply (non-stream). */
  delayMs?: number;
  /** Return this HTTP status with `errorBody` instead of a completion. */
  status?: number;
  errorBody?: string;
  totalTokens?: number;
}

export interface MockStats { requests: number; aborted: number }

/**
 * OpenAI-compatible fake LLM. `behave` decides per request, so one mock can
 * play a healthy, slow, rate-limited or broken provider.
 */
export function createMockLlm(name: string, behave: (body: Record<string, unknown>) => MockBehavior, stats: MockStats = { requests: 0, aborted: 0 }): Server {
  return createServer(async (req, res) => {
    stats.requests++;
    let closed = false;
    res.on("close", () => {
      if (!res.writableFinished) {
        closed = true;
        stats.aborted++;
      }
    });
    const body = JSON.parse((await readBody(req)) || "{}") as Record<string, unknown>;
    const b = behave(body);
    const chunks = b.chunks ?? ["Hello", " from ", name, "."];

    if (b.status && b.status >= 400) {
      if (b.delayMs) await sleep(b.delayMs);
      res.writeHead(b.status, { "content-type": "application/json" });
      return void res.end(b.errorBody ?? JSON.stringify({ error: { message: "mock failure" } }));
    }

    if (body.stream === true) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      for (const piece of chunks) {
        if (b.delayMs) await sleep(b.delayMs);
        if (closed) return;
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: piece } }] })}\n\n`);
      }
      return void res.end("data: [DONE]\n\n");
    }

    if (b.delayMs) await sleep(b.delayMs);
    if (closed) return;
    sendJson(res, 200, {
      model: name,
      choices: [{ index: 0, message: { role: "assistant", content: chunks.join("") } }],
      usage: { total_tokens: b.totalTokens ?? 100 },
    });
  });
}
