import type Anthropic from "@anthropic-ai/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { MODEL, assertModel, client, track } from "./claude.js";

export interface ToolEvent { name: string; input: unknown; ok: boolean; output: string; rpcCode?: number }
export interface AgentRun { final: string; tools: ToolEvent[]; transcript: Anthropic.MessageParam[]; stopReason: string | null; toolDefs: Anthropic.Tool[] }

const SYSTEM = [
  "You are a customer-support agent with access to tools.",
  "Use the tools to do what the user asks. Never invent values the user did not give you.",
  "If a tool call fails, read the error, fix your call if you can, otherwise tell the user plainly what went wrong.",
].join(" ");

/** Exposes the MCP server's tools to Claude, exactly as tools/list returned them. */
async function toolsFrom(mcp: Client): Promise<Anthropic.Tool[]> {
  const { tools } = await mcp.listTools();
  return tools.map((t) => {
    const { $schema: _drop, ...schema } = t.inputSchema as Record<string, unknown>;
    return { name: t.name, description: t.description ?? "", input_schema: schema as Anthropic.Tool.InputSchema };
  });
}

async function execute(mcp: Client, name: string, input: unknown): Promise<ToolEvent> {
  try {
    const res = await mcp.callTool({ name, arguments: input as Record<string, unknown> });
    const text = (res.content as { type: string; text?: string }[]).map((c) => c.text ?? "").join("\n");
    return { name, input, ok: !res.isError, output: text };
  } catch (err) {
    if (err instanceof McpError) {
      return { name, input, ok: false, rpcCode: err.code, output: `JSON-RPC error ${err.code}: ${err.message}${err.data ? `\n${JSON.stringify(err.data)}` : ""}` };
    }
    throw err;
  }
}

/** Manual tool-use loop: Claude <-> MCP server (directly or through the gateway). */
export async function runAgent(mcp: Client, prompt: string, maxTurns = 8): Promise<AgentRun> {
  const tools = await toolsFrom(mcp);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  const events: ToolEvent[] = [];
  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await client.messages.create({ model: MODEL, max_tokens: 16000, system: SYSTEM, tools, messages });
    track(MODEL, res.usage);
    assertModel(MODEL, res.model);
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason !== "tool_use") {
      const final = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
      return { final, tools: events, transcript: messages, stopReason: res.stop_reason, toolDefs: tools };
    }
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      const ev = await execute(mcp, block.name, block.input);
      events.push(ev);
      results.push({ type: "tool_result", tool_use_id: block.id, content: ev.output, is_error: !ev.ok });
    }
    messages.push({ role: "user", content: results });
  }
  return { final: "(max turns reached)", tools: events, transcript: messages, stopReason: "max_turns", toolDefs: tools };
}

/** Compact, judge-readable view of what the agent did. */
export function describeRun(run: AgentRun): string {
  const calls = run.tools.map((t, i) => `${i + 1}. ${t.name}(${JSON.stringify(t.input)}) -> ${t.ok ? "OK" : "ERROR"}: ${t.output.slice(0, 400)}`);
  // The agent may cite tool schemas; the judge needs them to check those claims.
  const defs = run.toolDefs.map((t) => `${t.name}: ${t.description} ${JSON.stringify(t.input_schema)}`).join("\n");
  return `TOOLS AVAILABLE TO THE AGENT:\n${defs}\n\nTOOL CALLS:\n${calls.join("\n") || "(no tool calls)"}\n\nFINAL MESSAGE TO USER:\n${run.final}`;
}
