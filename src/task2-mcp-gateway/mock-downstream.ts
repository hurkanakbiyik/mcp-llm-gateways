import { createServer, type Server } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

/** Every tools/call the downstream actually executed, so tests can prove the gateway blocked a call. */
export interface CallLog { calls: { tool: string; role: string | undefined }[] }

function buildServer(log: CallLog, role: string | undefined): McpServer {
  const mcp = new McpServer({ name: "mock-downstream", version: "1.0.0" });
  const record = (tool: string) => log.calls.push({ tool, role });

  mcp.registerTool("get_customer_record", { description: "Read a customer record.", inputSchema: { customer_id: z.string() } }, async ({ customer_id }) => {
    record("get_customer_record");
    return { content: [{ type: "text", text: JSON.stringify({ customer_id, name: "Ada Lovelace" }) }] };
  });
  mcp.registerTool("admin_reset_key", { description: "ADMIN ONLY. Rotate a customer's API key.", inputSchema: { customer_id: z.string() } }, async ({ customer_id }) => {
    record("admin_reset_key");
    return { content: [{ type: "text", text: `API key for ${customer_id} rotated` }] };
  });
  return mcp;
}

/** Real MCP server (SDK, Streamable HTTP, stateless) used as the gateway's downstream. */
export function createMockDownstream(log: CallLog = { calls: [] }): Server {
  return createServer(async (req, res) => {
    const role = req.headers["x-gateway-role"] as string | undefined;
    // Stateless mode: a fresh server + transport per request, as the SDK recommends.
    const mcp = buildServer(log, role);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => void transport.close());
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  });
}
