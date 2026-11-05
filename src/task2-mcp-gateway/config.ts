import { z } from "zod";
import { Port, parseEnv } from "../shared/config.js";

export const DEV_SECRET = "dev-secret-change-me";

const Env = z
  .object({
    NODE_ENV: z.string().default("development"),
    PORT: Port(8080),
    DOWNSTREAM_URL: z.url().optional(), // unset: start the bundled mock downstream
    DOWNSTREAM_PORT: Port(0),
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters").optional(),
  })
  .refine((e) => e.NODE_ENV !== "production" || e.JWT_SECRET, { message: "JWT_SECRET is required when NODE_ENV=production", path: ["JWT_SECRET"] });

export function loadConfig(env?: NodeJS.ProcessEnv) {
  const e = parseEnv(Env, env);
  return { ...e, jwtSecret: e.JWT_SECRET ?? DEV_SECRET, devSecret: !e.JWT_SECRET };
}
