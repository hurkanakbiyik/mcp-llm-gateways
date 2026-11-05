import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../shared/log.js";

/**
 * Stdio transport that answers unreadable lines. The SDK drops a line it
 * cannot parse and only fires onerror; JSON-RPC 2.0 requires a reply with
 * id null: -32700 for invalid JSON, -32600 for a bad envelope.
 */
export function createStdioTransport(): StdioServerTransport {
  const transport = new StdioServerTransport();
  // Set before server.connect(): Protocol keeps and chains an existing onerror.
  transport.onerror = (err) => {
    const code = err instanceof SyntaxError ? -32700 : err?.name === "ZodError" ? -32600 : null;
    logger.warn({ err }, "transport error");
    if (code === null) return;
    const message = code === -32700 ? "Parse error" : "Invalid Request";
    void transport.send({ jsonrpc: "2.0", id: null, error: { code, message } } as unknown as JSONRPCMessage);
  };
  return transport;
}
