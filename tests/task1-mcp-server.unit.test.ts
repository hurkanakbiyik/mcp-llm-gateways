import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMcpServer } from "../src/task1-mcp-server/server.js";

// Same server, wired in-process so coverage sees it (the e2e suite runs it as a child process).
let client: Client;
beforeAll(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer().connect(serverSide);
  client = new Client({ name: "unit", version: "1" });
  await client.connect(clientSide);
});
afterAll(() => client.close());

const rpcCode = (p: Promise<unknown>) => p.then(() => "resolved", (e: unknown) => (e instanceof McpError ? e.code : String(e)));

describe("MCP server handlers (Task 1, in-process)", () => {
  it("when a refund is valid, then it returns structured content with a refund id", async () => {
    // Act
    const res = await client.callTool({ name: "trigger_refund", arguments: { customer_id: "CUST-10001", amount: 5.5, reason: "Late delivery compensation" } });
    // Assert
    expect(res.structuredContent).toMatchObject({ status: "refund_triggered", amount: 5.5, refund_id: expect.stringMatching(/^RF-/) });
  });

  it("when a refund targets an unknown customer, then it returns isError and no refund", async () => {
    const res = await client.callTool({ name: "trigger_refund", arguments: { customer_id: "CUST-00000", amount: 1, reason: "Customer requested refund" } });
    expect(res.isError).toBe(true);
  });

  it.each([
    ["get_customer_record", { customer_id: "CUST-1" }],
    ["trigger_refund", { customer_id: "CUST-10001", amount: 0, reason: "Customer requested refund" }],
    ["no_such_tool", {}],
  ])("when %s gets bad input, then the client sees McpError -32602", async (name, args) => {
    expect(await rpcCode(client.callTool({ name, arguments: args }))).toBe(-32602);
  });
});
