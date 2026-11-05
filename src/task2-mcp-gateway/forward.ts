import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { Principal } from "./auth.js";

// Allowlists, not denylists: the client's Authorization header and anything
// else not listed never reaches the downstream server.
const REQUEST_HEADERS = ["content-type", "accept", "mcp-session-id", "mcp-protocol-version", "last-event-id"];
const RESPONSE_HEADERS = ["content-type", "mcp-session-id", "cache-control"];

/** Forwards one request to the downstream MCP server and streams the reply back (JSON or SSE). */
export async function forward(req: IncomingMessage, res: ServerResponse, downstreamUrl: string, principal: Principal, body?: string): Promise<void> {
  const headers: Record<string, string> = { "accept-encoding": "identity", "x-gateway-user": principal.sub, "x-gateway-role": principal.role };
  for (const h of REQUEST_HEADERS) {
    const v = req.headers[h];
    if (typeof v === "string") headers[h] = v;
  }

  // If the client goes away (e.g. closes an SSE stream), stop the downstream call too.
  const abort = new AbortController();
  res.on("close", () => abort.abort());

  const upstream = await fetch(downstreamUrl, { method: req.method, headers, body, signal: abort.signal });

  const out: Record<string, string> = {};
  for (const h of RESPONSE_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) out[h] = v;
  }
  res.writeHead(upstream.status, out);
  if (!upstream.body) return void res.end();
  Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream).on("error", () => res.destroy()).pipe(res);
}
