import type { IncomingMessage, ServerResponse } from "node:http";

export class BodyTooLargeError extends Error {}

/** Reads a request body up to `limit` bytes. Throws BodyTooLargeError past the limit. */
export async function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new BodyTooLargeError(`body exceeds ${limit} bytes`);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload), "x-content-type-options": "nosniff", ...headers });
  res.end(payload);
}

export function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}

/** Liveness probe for load balancers and orchestrators (nodebestpractices 5.7). Returns true if handled. */
export function handleHealth(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== "GET" || req.url !== "/healthz") return false;
  sendJson(res, 200, { status: "ok" });
  return true;
}
