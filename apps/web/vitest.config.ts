import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Playwright owns e2e/*.spec.ts; Vitest only runs unit tests.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "e2e/**", ".next/**"],
    // DATABASE_URL from the repo-root .env locally; CI sets it directly.
    env: loadEnv("test", "../..", ""),
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
