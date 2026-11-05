import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { tmpDbPath } from "./helpers/tmpdb.js";

/** Starts the Task 4 entrypoint as a real process and waits for its "listening" log line. */
async function startRouter(env: Record<string, string> = {}): Promise<{ proc: ChildProcessWithoutNullStreams; url: string; stderr: () => string }> {
  const proc = spawn("node_modules/.bin/tsx", ["src/task4-router/main.ts"], { env: { ...process.env, LOG_SILENT: "0", PORT: "0", DB_PATH: tmpDbPath(), ...env } });
  let err = "";
  proc.stderr.on("data", (d) => (err += d));
  const url = await new Promise<string>((resolve, reject) => {
    proc.stderr.on("data", () => {
      const m = /"url":"(http:\/\/[^"]+)\/v1/.exec(err);
      if (m) resolve(m[1]!);
    });
    proc.on("exit", () => reject(new Error(`exited early: ${err}`)));
  });
  return { proc, url, stderr: () => err };
}

describe("Service process lifecycle (nodebestpractices 5.7, 8.6)", () => {
  it("when the router runs, then GET /healthz answers 200 without an API key", async () => {
    // Arrange
    const { proc, url } = await startRouter();
    // Act
    const res = await fetch(`${url}/healthz`);
    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    proc.kill("SIGTERM");
    await once(proc, "exit");
  });

  it("when the router gets SIGTERM, then it closes the server and DB and exits 0", async () => {
    // Arrange
    const { proc, stderr } = await startRouter();
    // Act
    proc.kill("SIGTERM");
    const [code] = await once(proc, "exit");
    // Assert
    expect(code).toBe(0);
    expect(stderr()).toContain('"reason":"SIGTERM"');
  });

  it("when config is invalid, then the process fails fast with a non-zero exit", async () => {
    // Arrange
    const proc = spawn("node_modules/.bin/tsx", ["src/task4-router/main.ts"], { env: { ...process.env, TOKENS_PER_MINUTE: "lots" } });
    let err = "";
    proc.stderr.on("data", (d) => (err += d));
    // Act
    const [code] = await once(proc, "exit");
    // Assert
    expect(code).not.toBe(0);
    expect(err).toContain("Invalid configuration");
  });
});
