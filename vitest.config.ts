import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    env: { LOG_SILENT: "1" },
    testTimeout: 15_000,
    // nodebestpractices 4.7. Entrypoints run as child processes in e2e tests,
    // which v8 coverage in this process cannot see, so they are excluded.
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/main.ts"],
      reporter: ["text-summary", "text"],
      // Floors a few points under the measured numbers: fail the build on a drop.
      thresholds: { statements: 78, branches: 70, functions: 75, lines: 82 },
    },
  },
});
