import type { Server } from "node:http";
import { anthropicProvider } from "../providers/anthropic.js";
import { openAiCompatible } from "../providers/openai-compatible.js";
import type { LlmProvider } from "../providers/types.js";
import { createMockLlm, type MockBehavior } from "../mocks/llm-provider.js";
import { closeServer, installLifecycle } from "../shared/lifecycle.js";
import { listen } from "../shared/listen.js";
import { logger } from "../shared/log.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { createRouterGateway } from "./gateway.js";
import { TokenRateLimiter } from "./rate-limiter.js";

const config = loadConfig();
const db = openDb(config.DB_PATH);
const servers: Server[] = [];
installLifecycle([() => Promise.all(servers.map(closeServer)), () => db.close()]);

// Without URLs: a mock primary that always answers 429 and a healthy mock secondary.
async function provider(name: string, url: string | undefined, mock: MockBehavior): Promise<LlmProvider> {
  if (url === "anthropic") return anthropicProvider();
  if (url) return openAiCompatible(name, url);
  const server = createMockLlm(name, () => mock);
  servers.push(server);
  return openAiCompatible(name, await listen(server));
}

const providers = [await provider("primary", config.PRIMARY_URL, { status: 429 }), await provider("secondary", config.SECONDARY_URL, {})];
const limiter = new TokenRateLimiter(db, { limit: config.TOKENS_PER_MINUTE });
const gateway = createRouterGateway({ providers, limiter, tenants: config.TENANT_KEYS, timeoutMs: config.PROVIDER_TIMEOUT_MS });
servers.push(gateway);
const url = await listen(gateway, config.PORT);
logger.info({ url: url + "/v1/chat/completions", tenants: config.TENANT_KEYS.size }, "router gateway listening");
