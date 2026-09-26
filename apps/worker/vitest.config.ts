import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // DATABASE_URL and S3_* from the repo-root .env locally; CI sets them directly.
  test: { env: loadEnv("test", "../..", ""), testTimeout: 30_000, hookTimeout: 60_000 },
});
