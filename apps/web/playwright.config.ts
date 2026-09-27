import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "vite";

// Same env as the app: repo-root .env locally, job env in CI.
Object.assign(process.env, { ...loadEnv("test", "../..", ""), ...process.env });

const port = 3100;
// Its own realtime port, so a running `pnpm dev` (3200) doesn't get in the way.
const realtimePort = 3201;
process.env.REALTIME_SECRET ||= "e2e-realtime-secret";
process.env.UNSUBSCRIBE_SECRET ||= "e2e-unsubscribe-secret";

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Runs against a production build; `pnpm build` must run first.
  webServer: [
    {
      command: `pnpm start --port ${port}`,
      env: { BETTER_AUTH_URL: `http://localhost:${port}`, REALTIME_PUBLIC_URL: `ws://localhost:${realtimePort}` },
      url: `http://localhost:${port}`,
      reuseExistingServer: !process.env.CI,
    },
    // Live updates (P-06).
    {
      command: "pnpm --filter @kasa/realtime start",
      env: { REALTIME_PORT: String(realtimePort), REALTIME_ALLOWED_ORIGINS: `http://localhost:${port}` },
      url: `http://localhost:${realtimePort}/health`,
      reuseExistingServer: !process.env.CI,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    },
    // The worker processes photo uploads, unfurls links, and handles notifications for the
    // feed tests; links unfurl only from local test servers, never the internet.
    {
      command: "pnpm --filter @kasa/worker start",
      // Never real emails from tests, even if the local .env has a Resend key.
      env: { UNFURL_LOOPBACK_ONLY: "1", RESEND_API_KEY: "" },
      wait: { stdout: /worker started/ },
      reuseExistingServer: !process.env.CI,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    },
  ],
});
