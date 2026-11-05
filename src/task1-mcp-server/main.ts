import { installLifecycle } from "../shared/lifecycle.js";
import { logger } from "../shared/log.js";
import { createMcpServer } from "./server.js";
import { createStdioTransport } from "./stdio.js";

// Defense in depth: stdout carries JSON-RPC only. If any code (ours or a
// dependency) calls console.log/info/debug, send it to stderr instead of
// corrupting the protocol stream.
// eslint-disable-next-line no-console -- the one intended use: rebinding, not calling
console.log = console.info = console.debug = (...args: unknown[]) => console.error(...args);

const server = createMcpServer();
// Unknown errors exit the process; the MCP client owns restarting it.
installLifecycle([() => server.close()]);
await server.connect(createStdioTransport());
logger.info("customer-support-mcp listening on stdio");
