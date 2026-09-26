import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // S3_* from the repo-root .env locally; CI sets them directly.
  test: { env: loadEnv("test", "../..", ""), testTimeout: 30_000 },
});
