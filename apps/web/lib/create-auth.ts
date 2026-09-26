import { schema, type Database } from "@kasa/db";
import { track } from "@kasa/shared";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins/bearer";
import { oneTimeToken } from "better-auth/plugins/one-time-token";

export interface AuthConfig {
  db: Database;
  secret: string;
  baseURL?: string;
  google?: { clientId: string; clientSecret: string };
}

/**
 * Google sign-in with database sessions (D-004, D-127).
 *
 * Extension handoff (D-010, D-128): a signed-in web page calls
 * GET /api/auth/one-time-token/generate and passes the single-use code to the
 * extension, which exchanges it at POST /api/auth/one-time-token/verify for the
 * session token and then calls the API with `Authorization: Bearer <token>`.
 */
export function createAuth(config: AuthConfig) {
  return betterAuth({
    secret: config.secret,
    baseURL: config.baseURL,
    database: drizzleAdapter(config.db, {
      provider: "pg",
      usePlural: true,
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
      },
    }),
    user: { fields: { image: "avatarUrl" } },
    socialProviders: config.google
      ? { google: { clientId: config.google.clientId, clientSecret: config.google.clientSecret, prompt: "select_account" } }
      : {},
    advanced: { database: { generateId: "uuid" } },
    databaseHooks: {
      user: { create: { after: async (user) => void (await track("signed_up", user.id)) } },
      session: { create: { after: async (session) => void (await track("signed_in", session.userId)) } },
    },
    plugins: [
      bearer(),
      oneTimeToken({ expiresIn: 3, storeToken: "hashed", disableSetSessionCookie: true }),
    ],
  });
}
