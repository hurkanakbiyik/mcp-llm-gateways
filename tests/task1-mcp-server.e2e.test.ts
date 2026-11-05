import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RawStdioClient } from "./helpers/stdio-rpc.js";

let rpc: RawStdioClient;
let nextId = 100;
const call = (name: string, args: unknown) => rpc.request(nextId++, "tools/call", { name, arguments: args });

beforeAll(async () => {
  rpc = new RawStdioClient();
  await rpc.initialize();
});
afterAll(() => rpc.close());

describe("MCP server (Task 1): happy-path protocol flow", () => {
  it("when a client sends tools/list, then both tools come back with strict JSON Schemas", async () => {
    // Act
    const res = await rpc.request(1, "tools/list");
    const byName = Object.fromEntries(res.result.tools.map((t: any) => [t.name, t]));
    // Assert
    expect(Object.keys(byName).sort()).toEqual(["get_customer_record", "trigger_refund"]);
    expect(byName.get_customer_record.inputSchema.properties.customer_id.pattern).toBe("^CUST-\\d{5}$");
    expect(byName.trigger_refund.inputSchema.additionalProperties).toBe(false);
    expect(byName.trigger_refund.inputSchema.properties.reason.minLength).toBe(10);
  });

  it("when get_customer_record gets a known id, then it returns the record", async () => {
    const res = await call("get_customer_record", { customer_id: "CUST-10001" });
    expect(res.result.structuredContent).toMatchObject({ customer_id: "CUST-10001", name: "Ada Lovelace" });
  });

  it("when trigger_refund gets valid input, then it returns a refund id", async () => {
    const res = await call("trigger_refund", { customer_id: "CUST-12345", amount: 19.99, reason: "Duplicate charge on invoice" });
    expect(res.result.structuredContent).toMatchObject({ status: "refund_triggered", amount: 19.99, refund_id: expect.stringMatching(/^RF-\d{6}$/) });
  });

  it("when the customer does not exist, then it returns an isError result, not a protocol error", async () => {
    // Act
    const res = await call("get_customer_record", { customer_id: "CUST-99999" });
    // Assert
    expect(res.error).toBeUndefined();
    expect(res.result.isError).toBe(true);
  });
});

describe("MCP server (Task 1): input validation", () => {
  const badIds: unknown[] = ["CUST-1234", "CUST-123456", "cust-12345", " CUST-12345", "CUST-12345\n", "CUST-1234a", "XCUST-12345", 12345, null, ""];
  it.each(badIds.map((v) => [JSON.stringify(v), v]))("when customer_id is %s, then it answers -32602 naming customer_id", async (_label, customer_id) => {
    // Act
    const res = await call("get_customer_record", { customer_id });
    // Assert
    expect(res.error.code).toBe(-32602);
    expect(res.error.data.issues[0].path).toBe("customer_id");
  });

  const good = { customer_id: "CUST-12345", amount: 10, reason: "Customer was double billed" };
  const badRefunds: [string, Record<string, unknown>, string][] = [
    ["zero amount", { ...good, amount: 0 }, "amount"],
    ["negative amount", { ...good, amount: -5 }, "amount"],
    ["string amount", { ...good, amount: "10" }, "amount"],
    ["null amount", { ...good, amount: null }, "amount"],
    ["9-char reason", { ...good, reason: "too short" }, "reason"],
    ["whitespace-padded short reason", { ...good, reason: "   short    " }, "reason"],
    ["10 spaces reason", { ...good, reason: "          " }, "reason"],
    ["non-string reason", { ...good, reason: 1234567890 }, "reason"],
    ["missing reason", { customer_id: good.customer_id, amount: 10 }, "reason"],
    ["unknown extra field", { ...good, approve: true }, "(root)"],
  ];
  it.each(badRefunds)("when a refund has %s, then it answers -32602 naming the field", async (_label, args, path) => {
    // Act
    const res = await call("trigger_refund", args);
    // Assert
    expect(res.error.code).toBe(-32602);
    expect(res.error.data.issues.map((i: any) => i.path)).toContain(path);
  });

  it("when amount is 1e999 (parsed as Infinity), then it answers -32602", async () => {
    // Arrange
    const id = nextId++;
    const line = `{"jsonrpc":"2.0","id":${id},"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-12345","amount":1e999,"reason":"Customer was double billed"}}}`;
    // Act
    const res = await rpc.sendRaw(line, id);
    // Assert
    expect(res.error.code).toBe(-32602);
  });

  it("when arguments is an array, then it answers -32602, not -32603", async () => {
    expect((await call("get_customer_record", ["CUST-12345"])).error.code).toBe(-32602);
  });

  it("when tools/call has no tool name, then it answers -32602", async () => {
    expect((await rpc.request(nextId++, "tools/call", { arguments: {} })).error.code).toBe(-32602);
  });

  it("when the tool name is unknown, then it answers -32602", async () => {
    expect((await call("delete_everything", {})).error.code).toBe(-32602);
  });
});

describe("MCP server (Task 1): JSON-RPC envelope errors", () => {
  it("when a line is not JSON, then it answers -32700 with id null", async () => {
    expect((await rpc.sendRaw("{not json", null)).error.code).toBe(-32700);
  });
  it("when jsonrpc is not 2.0, then it answers -32600", async () => {
    expect((await rpc.sendRaw('{"jsonrpc":"1.0","id":5,"method":"tools/list"}', null)).error.code).toBe(-32600);
  });
  it("when the method is unknown, then it answers -32601", async () => {
    expect((await rpc.request(nextId++, "tools/destroy")).error.code).toBe(-32601);
  });
});

describe("MCP server (Task 1): stdio isolation", () => {
  it("when the whole suite has run, then every stdout line is JSON-RPC 2.0 and logs are on stderr", () => {
    expect(rpc.stdoutLines.length).toBeGreaterThan(20);
    for (const line of rpc.stdoutLines) expect(JSON.parse(line).jsonrpc).toBe("2.0");
    expect(rpc.stderr).toContain("listening on stdio");
    expect(rpc.stderr).toContain("tool input rejected");
  });

  it("when scanning the server source, then no code writes to stdout", () => {
    const dir = "src/task1-mcp-server";
    for (const f of readdirSync(dir)) {
      const src = readFileSync(`${dir}/${f}`, "utf8").replace(/^console\.log = .*$/m, "");
      expect(src, f).not.toMatch(/console\.(log|info|debug)\(|process\.stdout\.write|\bprint\(/);
    }
  });
});

describe("MCP server (Task 1): official SDK client", () => {
  it("when the SDK client sends invalid input, then it receives McpError -32602", async () => {
    // Arrange
    const client = new Client({ name: "sdk-test", version: "1" });
    await client.connect(new StdioClientTransport({ command: "node_modules/.bin/tsx", args: ["src/task1-mcp-server/main.ts"], stderr: "pipe" }));
    // Act
    const ok = await client.callTool({ name: "get_customer_record", arguments: { customer_id: "CUST-10002" } });
    // Assert
    expect(ok.structuredContent).toMatchObject({ name: "Alan Turing" });
    const err = await client.callTool({ name: "trigger_refund", arguments: { customer_id: "CUST-10002", amount: -1, reason: "x" } }).catch((e) => e);
    expect(err).toBeInstanceOf(McpError);
    expect(err.code).toBe(-32602);
    await client.close();
  });
});
