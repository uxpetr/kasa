import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@kasa/shared", "@kasa/ui"],
};

export default nextConfig;
