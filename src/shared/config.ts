import { z } from "zod";

export class ConfigError extends Error {}

export const Port = (fallback: number) => z.coerce.number().int().min(0).max(65_535).default(fallback);

/**
 * Validates environment variables once at startup (nodebestpractices 1.4):
 * typed, with defaults, and failing fast with a readable message instead of
 * breaking on the first request.
 */
export function parseEnv<T extends z.ZodType>(schema: T, env: NodeJS.ProcessEnv = process.env): z.infer<T> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new ConfigError(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
