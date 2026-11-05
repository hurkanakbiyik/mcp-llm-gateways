import type { Server } from "node:http";
import { logger } from "./log.js";

type Closer = () => unknown;

const GRACE_MS = 5_000; // let in-flight requests (incl. SSE streams) finish
const HARD_EXIT_MS = 10_000; // never hang on shutdown

/** Stops accepting connections, closes idle ones now and busy ones after GRACE_MS. */
export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), GRACE_MS).unref();
  });
}

/**
 * Process-level safety net, per nodebestpractices 2.6, 2.10 and 8.6:
 * - SIGTERM/SIGINT: run closers, exit 0.
 * - Unknown error (uncaughtException / unhandledRejection): log as fatal,
 *   run closers, exit 1. The app state is unknown, so we let the supervisor
 *   (Docker, systemd, the MCP client) restart a clean process.
 */
export function installLifecycle(closers: Closer[] = []): void {
  let stopping = false;
  async function shutdown(code: number, reason: string): Promise<void> {
    if (stopping) return;
    stopping = true;
    logger.info({ reason }, "shutting down");
    setTimeout(() => process.exit(code), HARD_EXIT_MS).unref();
    for (const close of closers) {
      try {
        await close();
      } catch (err) {
        logger.error({ err }, "error during shutdown");
      }
    }
    process.exit(code);
  }

  process.once("SIGTERM", () => void shutdown(0, "SIGTERM"));
  process.once("SIGINT", () => void shutdown(0, "SIGINT"));
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "uncaught exception");
    void shutdown(1, "uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "unhandled rejection");
    void shutdown(1, "unhandledRejection");
  });
}
