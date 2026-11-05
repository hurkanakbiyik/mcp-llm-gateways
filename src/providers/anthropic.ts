import Anthropic from "@anthropic-ai/sdk";
import { UpstreamError, type CompletionRequest, type CompletionResult, type LlmProvider } from "./types.js";

const DEFAULT_MODEL = "claude-opus-5-5";

function toAnthropic(req: CompletionRequest) {
  const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const messages = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  return {
    model: req.model ?? DEFAULT_MODEL,
    max_tokens: req.max_tokens ?? 16000,
    ...(system ? { system } : {}),
    messages,
  };
}

function normalize(err: unknown, signal: AbortSignal): unknown {
  if (signal.aborted) return err;
  if (err instanceof Anthropic.RateLimitError) return new UpstreamError("rate_limited", 429, err.message);
  if (err instanceof Anthropic.APIConnectionError) return new UpstreamError("network", undefined, err.message);
  if (err instanceof Anthropic.APIError) return new UpstreamError("http_error", err.status, err.message);
  return err;
}

/** Claude via the official SDK. Retries are off: the gateway owns fallback. */
export function anthropicProvider(client = new Anthropic({ maxRetries: 0 })): LlmProvider {
  return {
    name: "anthropic",
    async *stream(req, signal) {
      try {
        const stream = client.messages.stream(toAnthropic(req), { signal });
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
        }
      } catch (err) {
        throw normalize(err, signal);
      }
    },
    async complete(req, signal): Promise<CompletionResult> {
      try {
        const msg = await client.messages.create(toAnthropic(req), { signal });
        const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
        return { text, model: msg.model, usage: { total_tokens: msg.usage.input_tokens + msg.usage.output_tokens } };
      } catch (err) {
        throw normalize(err, signal);
      }
    },
  };
}
