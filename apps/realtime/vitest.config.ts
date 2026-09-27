import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // DATABASE_URL from the repo-root .env locally; CI sets it directly.
    env: loadEnv("test", "../..", ""),
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
