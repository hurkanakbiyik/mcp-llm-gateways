import { createHmac, timingSafeEqual } from "node:crypto";

export type Role = "admin" | "viewer";
export interface Principal { sub: string; role: Role }

const ROLES: readonly string[] = ["admin", "viewer"];

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

/** Minimal HS256 JWT signer. Used by tests, evals and the dev CLI. */
export function signToken(payload: { sub: string; role: string; exp?: number }, secret: string): string {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

/**
 * Verifies an HS256 JWT and extracts the principal. Returns null on any
 * failure: bad shape, wrong alg (blocks alg=none), bad signature, expired,
 * or a role outside the allowlist.
 */
export function verifyToken(token: string, secret: string, now = Date.now()): Principal | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts as [string, string, string];
  try {
    const header = JSON.parse(Buffer.from(head, "base64url").toString("utf8"));
    if (header?.alg !== "HS256") return null;
    const expected = createHmac("sha256", secret).update(`${head}.${body}`).digest();
    const given = Buffer.from(sig, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof claims?.exp === "number" && claims.exp * 1000 <= now) return null;
    if (typeof claims?.sub !== "string" || !ROLES.includes(claims?.role)) return null;
    return { sub: claims.sub, role: claims.role as Role };
  } catch {
    return null;
  }
}
