import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { tmpDbPath } from "./helpers/tmpdb.js";

function worker(dbPath: string, attempts: number, tokens: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node_modules/.bin/tsx", ["tests/helpers/limiter-worker.ts", dbPath, String(attempts), String(tokens)]);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("exit", (code) => (code === 0 ? resolve(Number(out)) : reject(new Error(err))));
  });
}

describe("Token rate limiter across processes (Task 4)", () => {
  it("when 4 processes share one SQLite file, then together they admit exactly the 50k budget", async () => {
    // Arrange: 4 x 30 attempts x 1,000 tokens = 120k requested against a 50k budget
    const dbPath = tmpDbPath();
    // Act
    const admitted = await Promise.all([1, 2, 3, 4].map(() => worker(dbPath, 30, 1_000)));
    // Assert: BEGIN IMMEDIATE serializes check-and-insert across processes
    expect(admitted.reduce((a, b) => a + b, 0)).toBe(50);
  });
});
