import type { Server } from "node:http";
import { anthropicProvider } from "../providers/anthropic.js";
import { openAiCompatible } from "../providers/openai-compatible.js";
import type { LlmProvider } from "../providers/types.js";
import { createMockLlm } from "../mocks/llm-provider.js";
import { closeServer, installLifecycle } from "../shared/lifecycle.js";
import { listen } from "../shared/listen.js";
import { logger } from "../shared/log.js";
import { loadConfig } from "./config.js";
import { createGuardrailGateway } from "./gateway.js";

const config = loadConfig();
const servers: Server[] = [];
installLifecycle([() => Promise.all(servers.map(closeServer))]);

async function pickProvider(): Promise<LlmProvider> {
  if (config.LLM_PROVIDER === "anthropic") return anthropicProvider();
  if (config.LLM_PROVIDER === "openai") return openAiCompatible("openai-compatible", config.UPSTREAM_URL!, config.UPSTREAM_API_KEY);
  const demo = "Sure. Contact jane.roe@example.com, SSN 078-05-1120, card 4111 1111 1111 1111. Anything else?";
  const mock = createMockLlm("mock", () => ({ chunks: demo.match(/.{1,4}/g)!, delayMs: 20 }));
  servers.push(mock);
  return openAiCompatible("mock", await listen(mock));
}

const provider = await pickProvider();
const gateway = createGuardrailGateway(provider);
servers.push(gateway);
const url = await listen(gateway, config.PORT);
logger.info({ url: url + "/v1/chat/completions", provider: provider.name }, "llm guardrail gateway listening");
