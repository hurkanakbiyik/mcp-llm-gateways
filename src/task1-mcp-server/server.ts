import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ErrorCode, ListToolsRequestSchema, McpError, type CallToolRequest, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { logger } from "../shared/log.js";
import { TOOLS, isToolName, issuesOf } from "./schemas.js";
import { createRefund, getCustomer } from "./store.js";

// We use the low-level Server on purpose: McpServer (SDK 1.32) catches input
// validation failures and returns them as `isError: true` tool results. The
// assessment requires a JSON-RPC error (-32602) instead, so we own the handler.

// Loose envelope on purpose. With the strict CallToolRequestSchema, the SDK's
// protocol layer turns malformed params (e.g. `arguments: []`) into -32603
// Internal error. With this schema the request reaches Server's tools/call
// wrapper, which re-validates it and answers -32602 Invalid params.
const LooseCallToolRequest = z.object({ method: z.literal("tools/call"), params: z.looseObject({}) });
export function createMcpServer(): Server {
  const server = new Server({ name: "customer-support-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.entries(TOOLS).map(([name, t]) => ({
      name,
      description: t.description,
      inputSchema: z.toJSONSchema(t.schema, { io: "input" }) as { type: "object" },
    })),
  }));

  server.setRequestHandler(LooseCallToolRequest, async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params as CallToolRequest["params"];
    if (!isToolName(name)) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    }
    const parsed = TOOLS[name].schema.safeParse(args ?? {});
    if (!parsed.success) {
      const issues = issuesOf(parsed.error);
      logger.warn({ tool: name, issues }, "tool input rejected");
      throw new McpError(ErrorCode.InvalidParams, `Invalid arguments for ${name}`, { issues });
    }
    logger.info({ tool: name }, "tool call");
    return name === "get_customer_record"
      ? getRecord(parsed.data as z.infer<typeof TOOLS.get_customer_record.schema>)
      : refund(parsed.data as z.infer<typeof TOOLS.trigger_refund.schema>);
  });

  return server;
}

function result(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

// Business failures (valid input, unknown customer) are tool execution errors
// per the MCP spec: a normal result with isError, so the model can react.
function notFound(id: string): CallToolResult {
  return { content: [{ type: "text", text: `Customer ${id} not found` }], isError: true };
}

function getRecord({ customer_id }: { customer_id: string }): CallToolResult {
  const customer = getCustomer(customer_id);
  return customer ? result({ ...customer }) : notFound(customer_id);
}

function refund({ customer_id, amount, reason }: { customer_id: string; amount: number; reason: string }): CallToolResult {
  if (!getCustomer(customer_id)) return notFound(customer_id);
  return result({ status: "refund_triggered", ...createRefund(customer_id, amount, reason) });
}
