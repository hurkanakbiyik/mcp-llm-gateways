import { sseData } from "./sse.js";
import { UpstreamError, type CompletionRequest, type CompletionResult, type LlmProvider } from "./types.js";

/**
 * Adapter for any OpenAI-compatible /v1/chat/completions endpoint
 * (the local mock, vLLM, Ollama, OpenAI, ...).
 */
export function openAiCompatible(name: string, baseUrl: string, apiKey?: string, defaultModel = "default"): LlmProvider {
  async function post(req: CompletionRequest, stream: boolean, signal: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model: req.model ?? defaultModel, messages: req.messages, max_tokens: req.max_tokens, stream }),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new UpstreamError("network", undefined, String(err));
    }
    if (res.status === 429) throw new UpstreamError("rate_limited", 429, await res.text());
    if (!res.ok) throw new UpstreamError("http_error", res.status, await res.text());
    return res;
  }

  return {
    name,
    async *stream(req, signal) {
      const res = await post(req, true, signal);
      for await (const data of sseData(res.body!)) {
        if (data === "[DONE]") return;
        const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length) yield delta;
      }
    },
    async complete(req, signal): Promise<CompletionResult> {
      const res = await post(req, false, signal);
      const json = (await res.json()) as { model?: string; choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number } };
      return {
        text: json.choices?.[0]?.message?.content ?? "",
        model: json.model ?? req.model ?? defaultModel,
        usage: { total_tokens: json.usage?.total_tokens ?? 0 },
      };
    },
  };
}
