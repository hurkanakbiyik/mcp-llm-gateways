import { z } from "zod";
import { Port, parseEnv } from "../shared/config.js";

const Env = z
  .object({
    PORT: Port(8081),
    LLM_PROVIDER: z.enum(["mock", "anthropic", "openai"]).default("mock"),
    UPSTREAM_URL: z.url().optional(),
    UPSTREAM_API_KEY: z.string().optional(),
  })
  .refine((e) => e.LLM_PROVIDER !== "openai" || e.UPSTREAM_URL, { message: "UPSTREAM_URL is required when LLM_PROVIDER=openai", path: ["UPSTREAM_URL"] });

export const loadConfig = (env?: NodeJS.ProcessEnv) => parseEnv(Env, env);
