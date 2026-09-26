import "server-only";
import { createDb, requireDatabaseUrl, type Database } from "@kasa/db";
import { createAuth } from "./create-auth";

// One Better Auth instance per server process, built on first use so a build
// without runtime env (CI, previews without a database) still succeeds.
let instance: ReturnType<typeof createAuth> | undefined;
let database: Database | undefined;

export function isAuthConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET);
}

export function isGoogleSignInConfigured(): boolean {
  return isAuthConfigured() && Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function getAuth() {
  if (!instance) {
    database ??= createDb(requireDatabaseUrl()).db;
    instance = createAuth({
      db: database,
      secret: requireEnv("BETTER_AUTH_SECRET"),
      baseURL: process.env.BETTER_AUTH_URL,
      google:
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
          ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }
          : undefined,
    });
  }
  return instance;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See .env.example.`);
  return value;
}
