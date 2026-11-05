import type { Server } from "node:http";
import { closeServer, installLifecycle } from "../shared/lifecycle.js";
import { listen } from "../shared/listen.js";
import { logger } from "../shared/log.js";
import { signToken } from "./auth.js";
import { loadConfig } from "./config.js";
import { createMcpGateway } from "./gateway.js";
import { createMockDownstream } from "./mock-downstream.js";

const config = loadConfig();
const servers: Server[] = [];
installLifecycle([() => Promise.all(servers.map(closeServer))]);

let downstreamUrl = config.DOWNSTREAM_URL;
if (!downstreamUrl) {
  const mock = createMockDownstream();
  servers.push(mock);
  downstreamUrl = (await listen(mock, config.DOWNSTREAM_PORT)) + "/mcp";
  logger.info({ downstreamUrl }, "mock downstream started");
}

const gateway = createMcpGateway({ downstreamUrl, jwtSecret: config.jwtSecret });
servers.push(gateway);
const url = await listen(gateway, config.PORT);
logger.info({ url: url + "/mcp", downstreamUrl }, "mcp gateway listening");

if (config.devSecret) {
  const admin = signToken({ sub: "alice", role: "admin" }, config.jwtSecret);
  const viewer = signToken({ sub: "bob", role: "viewer" }, config.jwtSecret);
  logger.warn({ admin, viewer }, "JWT_SECRET unset: using the dev secret. Dev tokens attached");
}
