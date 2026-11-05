import { pino } from "pino";

// Pino, written to stderr (fd 2). The guide's practice 5.18 says log to
// stdout, but Task 1 speaks JSON-RPC on stdout, so every service here keeps
// stdout free and logs to stderr. Runtimes capture both streams.
// sync: true so a fatal log line is on disk before the process exits.
export const logger = pino(
  { level: process.env.LOG_SILENT === "1" ? "silent" : (process.env.LOG_LEVEL ?? "info"), base: { service: process.env.SERVICE_NAME } },
  pino.destination({ dest: 2, sync: true }),
);

export type Logger = typeof logger;
