import { existsSync } from "node:fs";
import type { NextConfig } from "next";

// Local development keeps one .env at the repo root; hosted envs set variables directly.
const rootEnv = new URL("../../.env", import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  transpilePackages: ["@kasa/db", "@kasa/jobs", "@kasa/media", "@kasa/shared", "@kasa/ui"],
  // Native or Node-only; loaded at runtime instead of bundled.
  serverExternalPackages: ["pg-boss"],
};

export default nextConfig;
