// @ts-check
// nodebestpractices 3.1 (ESLint), 3.2 (Node plugins), 6.1 (security rules).
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import n from "eslint-plugin-n";
import security from "eslint-plugin-security";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["node_modules/", "dist/", "coverage/", "evals/results/"] },
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommended, security.configs.recommended],
    plugins: { n },
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      "n/prefer-node-protocol": "error", // 6.27
      "@typescript-eslint/return-await": ["error", "in-try-catch"], // 2.12: full stack traces
      "@typescript-eslint/no-floating-promises": "error", // 2.10
      "prefer-const": "error", // 3.7
      eqeqeq: "error", // 3.10
      "no-eval": "error", // 6.15
      // stdout carries JSON-RPC in Task 1; all diagnostics go through the stderr logger.
      "no-console": ["error", { allow: ["error"] }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Flags every obj[key]; our keys come from typed unions, not user input.
      "security/detect-object-injection": "off",
    },
  },
  {
    files: ["tests/**/*.ts", "evals/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off", "security/detect-non-literal-fs-filename": "off" },
  },
);
