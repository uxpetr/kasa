import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "vite";

// Same env as the app: repo-root .env locally, job env in CI.
Object.assign(process.env, { ...loadEnv("test", "../..", ""), ...process.env });

const port = 3100;

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
  webServer: {
    command: `pnpm start --port ${port}`,
    env: { BETTER_AUTH_URL: `http://localhost:${port}` },
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
