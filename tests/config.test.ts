import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/shared/config.js";
import { loadConfig as loadGateway } from "../src/task2-mcp-gateway/config.js";
import { loadConfig as loadGuardrail } from "../src/task3-llm-guardrail/config.js";
import { loadConfig as loadRouter } from "../src/task4-router/config.js";

describe("Service config (nodebestpractices 1.4)", () => {
  it("when no env is set, then every service starts with documented defaults", () => {
    // Act
    const router = loadRouter({});
    // Assert
    expect(loadGateway({})).toMatchObject({ PORT: 8080, devSecret: true });
    expect(loadGuardrail({})).toMatchObject({ PORT: 8081, LLM_PROVIDER: "mock" });
    expect(router).toMatchObject({ PORT: 8082, TOKENS_PER_MINUTE: 50_000, PROVIDER_TIMEOUT_MS: 3000 });
    expect([...router.TENANT_KEYS]).toEqual([["dev-key", "dev-tenant"]]);
  });

  it("when NODE_ENV=production and JWT_SECRET is missing, then the gateway refuses to start", () => {
    expect(() => loadGateway({ NODE_ENV: "production" })).toThrow(/JWT_SECRET is required/);
  });

  it("when JWT_SECRET is shorter than 32 chars, then it is rejected", () => {
    expect(() => loadGateway({ JWT_SECRET: "short" })).toThrow(ConfigError);
  });

  it("when LLM_PROVIDER=openai has no UPSTREAM_URL, then the guardrail refuses to start", () => {
    expect(() => loadGuardrail({ LLM_PROVIDER: "openai" })).toThrow(/UPSTREAM_URL is required/);
  });

  it.each([["PORT", "99999"], ["TOKENS_PER_MINUTE", "-5"], ["TENANT_KEYS", "no-colon"], ["TENANT_KEYS", "a:b,:c"], ["PRIMARY_URL", "not a url"]])(
    "when %s=%s, then the router refuses to start with a ConfigError",
    (key, value) => {
      expect(() => loadRouter({ [key]: value })).toThrow(ConfigError);
    },
  );

  it("when TENANT_KEYS lists several pairs, then each key maps to its tenant", () => {
    expect([...loadRouter({ TENANT_KEYS: "k1:t1, k2:t2" }).TENANT_KEYS]).toEqual([["k1", "t1"], ["k2", "t2"]]);
  });
});
