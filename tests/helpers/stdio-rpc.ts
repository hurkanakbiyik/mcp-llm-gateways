import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

const TSX = "node_modules/.bin/tsx";

/** Spawns the Task 1 server and talks raw JSON-RPC over its stdio. */
export class RawStdioClient {
  readonly proc: ChildProcessWithoutNullStreams;
  readonly stdoutLines: string[] = [];
  stderr = "";
  private waiters = new Map<string, (msg: any) => void>();

  constructor() {
    this.proc = spawn(TSX, ["src/task1-mcp-server/main.ts"], { env: { ...process.env, LOG_SILENT: "0" } });
    this.proc.stderr.on("data", (d) => (this.stderr += d));
    createInterface({ input: this.proc.stdout }).on("line", (line) => {
      this.stdoutLines.push(line);
      try {
        const msg = JSON.parse(line);
        this.waiters.get(String(msg.id))?.(msg);
      } catch {
        // Not JSON: the isolation test reports it.
      }
    });
  }

  /** Writes one raw line and waits for the response with the given id. */
  sendRaw(line: string, id: string | number | null): Promise<any> {
    return new Promise((resolve) => {
      this.waiters.set(String(id), resolve);
      this.proc.stdin.write(line + "\n");
    });
  }

  request(id: number, method: string, params?: unknown): Promise<any> {
    return this.sendRaw(JSON.stringify({ jsonrpc: "2.0", id, method, params }), id);
  }

  notify(method: string): void {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
  }

  async initialize(): Promise<any> {
    const res = await this.request(0, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    this.notify("notifications/initialized");
    return res;
  }

  close(): void {
    this.proc.kill();
  }
}
