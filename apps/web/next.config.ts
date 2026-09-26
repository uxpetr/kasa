import { existsSync } from "node:fs";
import type { NextConfig } from "next";

// Local development keeps one .env at the repo root; hosted envs set variables directly.
const rootEnv = new URL("../../.env", import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  transpilePackages: ["@kasa/db", "@kasa/shared", "@kasa/ui"],
};

export default nextConfig;
