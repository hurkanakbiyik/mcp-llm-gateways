import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/** Starts a server on `port` (0 = random) and resolves with its base URL. */
export function listen(server: Server, port = 0, host = "127.0.0.1"): Promise<string> {
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve(`http://${host}:${(server.address() as AddressInfo).port}`));
  });
}
