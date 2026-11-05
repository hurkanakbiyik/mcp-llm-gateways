import type { Server } from "node:http";
import { listen } from "../../src/shared/listen.js";

/** Starts servers on random ports and closes them all on cleanup. */
export class ServerPool {
  private servers: Server[] = [];
  async start(server: Server): Promise<string> {
    this.servers.push(server);
    return listen(server);
  }
  async closeAll(): Promise<void> {
    await Promise.all(this.servers.map((s) => new Promise((r) => { s.closeAllConnections(); s.close(r); })));
    this.servers = [];
  }
}
