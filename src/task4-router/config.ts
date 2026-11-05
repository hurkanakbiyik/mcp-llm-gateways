import { z } from "zod";
import { Port, parseEnv } from "../shared/config.js";

// "key1:tenant-a,key2:tenant-b" -> Map(api key -> tenant id)
const TenantKeys = z.string().transform((s, ctx) => {
  const pairs = s.split(",").map((p) => p.trim().split(":"));
  if (pairs.some((p) => p.length !== 2 || !p[0] || !p[1])) {
    ctx.addIssue({ code: "custom", message: 'TENANT_KEYS must look like "key1:tenant-a,key2:tenant-b"' });
    return z.NEVER;
  }
  return new Map(pairs as [string, string][]);
});

// An OpenAI-compatible base URL, or "anthropic" for Claude. Unset: start a mock.
const ProviderUrl = z.union([z.literal("anthropic"), z.url()]).optional();

const Env = z.object({
  PORT: Port(8082),
  PRIMARY_URL: ProviderUrl,
  SECONDARY_URL: ProviderUrl,
  TENANT_KEYS: TenantKeys.default(new Map([["dev-key", "dev-tenant"]])),
  TOKENS_PER_MINUTE: z.coerce.number().int().positive().default(50_000),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  DB_PATH: z.string().min(1).default("data/gateway.sqlite"),
});

export const loadConfig = (env?: NodeJS.ProcessEnv) => parseEnv(Env, env);
