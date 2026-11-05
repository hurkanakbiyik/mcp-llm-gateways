import { once } from "node:events";
import { createServer, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import { BodyTooLargeError, handleHealth, readBody, sendJson } from "../shared/http.js";
import { logger } from "../shared/log.js";
import type { LlmProvider } from "../providers/types.js";
import { createRedactor } from "./redactor.js";

const ChatRequest = z.object({
  model: z.string().optional(),
  messages: z.array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string() })).min(1),
  max_tokens: z.number().int().positive().optional(),
});

const chunk = (content: string) => `data: ${JSON.stringify({ object: "chat.completion.chunk", choices: [{ index: 0, delta: { content } }] })}\n\n`;

/** Writes with backpressure: waits for 'drain' when the client reads slower than the upstream produces. */
async function write(res: ServerResponse, data: string): Promise<void> {
  if (!res.write(data)) await once(res, "drain");
}

/**
 * POST /v1/chat/completions. Streams the provider's reply back as
 * OpenAI-style SSE, redacting PII on the fly. Memory per request is bounded
 * by the redactor's hold window, never by response length.
 */
export function createGuardrailGateway(provider: LlmProvider): Server {
  return createServer(async (req, res) => {
    if (handleHealth(req, res)) return;
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      return sendJson(res, 404, { error: { type: "not_found", message: "POST /v1/chat/completions" } });
    }
    let body: z.infer<typeof ChatRequest>;
    try {
      const parsed = ChatRequest.safeParse(JSON.parse(await readBody(req)));
      if (!parsed.success) return sendJson(res, 400, { error: { type: "invalid_request", message: z.prettifyError(parsed.error) } });
      body = parsed.data;
    } catch (err) {
      const tooLarge = err instanceof BodyTooLargeError;
      return sendJson(res, tooLarge ? 413 : 400, { error: { type: "invalid_request", message: tooLarge ? "body too large" : "invalid JSON" } });
    }

    // Client hung up: stop pulling from the provider at once.
    const abort = new AbortController();
    res.on("close", () => abort.abort());

    // Send headers now so the client sees the stream open before the first token.
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
    res.flushHeaders();

    const redactor = createRedactor();
    try {
      for await (const delta of provider.stream(body, abort.signal)) {
        const safe = redactor.push(delta);
        if (safe) await write(res, chunk(safe));
      }
      const tail = redactor.flush();
      if (tail) await write(res, chunk(tail));
      res.end("data: [DONE]\n\n");
    } catch (err) {
      if (abort.signal.aborted) return;
      logger.error({ provider: provider.name, error: String(err) }, "provider stream failed");
      // Held text may contain the start of PII; send it only after redaction.
      const tail = redactor.flush();
      if (tail) res.write(chunk(tail));
      res.end(`data: ${JSON.stringify({ error: { type: "upstream_error", message: "The model provider failed mid-stream. Retry the request." } })}\n\n`);
    }
  });
}
