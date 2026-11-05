import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signToken } from "../src/task2-mcp-gateway/auth.js";
import { createMcpGateway } from "../src/task2-mcp-gateway/gateway.js";
import { createMockDownstream, type CallLog } from "../src/task2-mcp-gateway/mock-downstream.js";
import { ServerPool } from "./helpers/servers.js";

const SECRET = "test-secret";
const admin = signToken({ sub: "alice", role: "admin" }, SECRET);
const viewer = signToken({ sub: "bob", role: "viewer" }, SECRET);
const pool = new ServerPool();
const downstream: CallLog = { calls: [] };
let gatewayUrl: string;

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: "agent", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(gatewayUrl), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return client;
}

const post = (body: string, token: string | null = viewer) =>
  fetch(gatewayUrl, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body });

beforeAll(async () => {
  const dsUrl = (await pool.start(createMockDownstream(downstream))) + "/mcp";
  gatewayUrl = (await pool.start(createMcpGateway({ downstreamUrl: dsUrl, jwtSecret: SECRET }))) + "/mcp";
});
afterAll(() => pool.closeAll());
beforeEach(() => void (downstream.calls.length = 0));

describe("MCP gateway (Task 2): forwarding", () => {
  it("when a viewer sends tools/list, then the downstream list comes back unchanged", async () => {
    // Arrange
    const client = await connect(viewer);
    // Act
    const { tools } = await client.listTools();
    // Assert
    expect(tools.map((t) => t.name).sort()).toEqual(["admin_reset_key", "get_customer_record"]);
    await client.close();
  });

  it("when a viewer calls a non-admin tool, then the call reaches downstream", async () => {
    // Arrange
    const client = await connect(viewer);
    // Act
    const res = await client.callTool({ name: "get_customer_record", arguments: { customer_id: "CUST-10001" } });
    // Assert
    expect(JSON.stringify(res.content)).toContain("Ada Lovelace");
    expect(downstream.calls).toEqual([{ tool: "get_customer_record", role: "viewer" }]);
    await client.close();
  });

  it("when an admin calls an admin_ tool, then the call reaches downstream", async () => {
    // Arrange
    const client = await connect(admin);
    // Act
    const res = await client.callTool({ name: "admin_reset_key", arguments: { customer_id: "CUST-10001" } });
    // Assert
    expect(JSON.stringify(res.content)).toContain("rotated");
    expect(downstream.calls).toEqual([{ tool: "admin_reset_key", role: "admin" }]);
    await client.close();
  });
});

describe("MCP gateway (Task 2): tool authorization", () => {
  it("when a viewer calls an admin_ tool, then it gets -32001 and downstream sees nothing", async () => {
    // Arrange
    const client = await connect(viewer);
    // Act
    const err = await client.callTool({ name: "admin_reset_key", arguments: { customer_id: "CUST-10001" } }).catch((e) => e);
    // Assert
    expect(err).toBeInstanceOf(McpError);
    expect(err.code).toBe(-32001);
    expect(err.message).toContain("Unauthorized Tool Call");
    expect(downstream.calls).toEqual([]);
    await client.close();
  });

  it("when a call is denied, then the error envelope carries the request id", async () => {
    // Act
    const res = await post(JSON.stringify({ jsonrpc: "2.0", id: "abc-1", method: "tools/call", params: { name: "admin_delete_tenant", arguments: {} } }));
    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jsonrpc: "2.0", id: "abc-1", error: { code: -32001, message: "Unauthorized Tool Call", data: { tool: "admin_delete_tenant", required_role: "admin", caller_role: "viewer" } } });
  });

  it("when the body is a batch, then it answers -32600 and forwards nothing", async () => {
    // Arrange
    const batch = [{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "admin_reset_key" } }];
    // Act + Assert
    expect((await (await post(JSON.stringify(batch))).json()).error.code).toBe(-32600);
    expect(downstream.calls).toEqual([]);
  });

  it("when params.name is not a string, then it answers -32602", async () => {
    const body = await (await post(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: 42 } }))).json();
    expect(body).toMatchObject({ id: 2, error: { code: -32602 } });
  });

  it("when the body is not JSON or the envelope is invalid, then it answers -32700 or -32600", async () => {
    expect((await (await post("{oops")).json()).error.code).toBe(-32700);
    expect((await (await post(JSON.stringify({ jsonrpc: "1.0", id: 3, method: "tools/list" }))).json()).error).toMatchObject({ code: -32600 });
  });
});

describe("MCP gateway (Task 2): authentication", () => {
  const forged = signToken({ sub: "eve", role: "admin" }, "wrong-secret");
  const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from('{"sub":"eve","role":"admin"}').toString("base64url")}.`;
  const expired = signToken({ sub: "bob", role: "admin", exp: Math.floor(Date.now() / 1000) - 10 }, SECRET);
  const badRole = signToken({ sub: "bob", role: "superadmin" }, SECRET);
  it.each([["missing", null], ["forged signature", forged], ["alg=none", none], ["expired", expired], ["unknown role", badRole], ["garbage", "abc"]])(
    "when the token is %s, then it answers HTTP 401 with -32000",
    async (_label, token) => {
      const res = await post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), token);
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe(-32000);
    },
  );
});

describe("MCP gateway (Task 2): proxy hygiene", () => {
  it("when forwarding, then the client Authorization and cookies are stripped and identity headers added", async () => {
    // Arrange
    let seen: Record<string, unknown> = {};
    const echo = createServer((req, res) => { seen = req.headers; res.writeHead(200, { "content-type": "application/json" }); res.end('{"jsonrpc":"2.0","id":1,"result":{}}'); });
    const gw = createMcpGateway({ downstreamUrl: await pool.start(echo), jwtSecret: SECRET });
    // Act
    const res = await fetch(await pool.start(gw), { method: "POST", headers: { authorization: `Bearer ${viewer}`, "content-type": "application/json", cookie: "s=1" }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
    // Assert
    expect(res.status).toBe(200);
    expect(seen.authorization).toBeUndefined();
    expect(seen.cookie).toBeUndefined();
    expect(seen["x-gateway-role"]).toBe("viewer");
  });

  it("when downstream is unreachable, then it answers 502 with -32603", async () => {
    // Arrange
    const gw = createMcpGateway({ downstreamUrl: "http://127.0.0.1:1/mcp", jwtSecret: SECRET });
    // Act
    const res = await fetch(await pool.start(gw), { method: "POST", headers: { authorization: `Bearer ${viewer}` }, body: '{"jsonrpc":"2.0","id":9,"method":"tools/list"}' });
    // Assert
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ id: 9, error: { code: -32603 } });
  });
});
