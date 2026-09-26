import { defineConfig } from "vitest/config";

// Playwright owns e2e/*.spec.ts; Vitest only runs unit tests.
export default defineConfig({
  test: { include: ["**/*.test.{ts,tsx}"], exclude: ["node_modules/**", "e2e/**", ".next/**"] },
});
