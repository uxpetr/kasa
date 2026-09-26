import "server-only";
import { createAuth } from "./create-auth";
import { getDb } from "./db";

// One Better Auth instance per server process, built on first use so a build
// without runtime env (CI, previews without a database) still succeeds.
let instance: ReturnType<typeof createAuth> | undefined;

export function isAuthConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET);
}

export function isGoogleSignInConfigured(): boolean {
  return isAuthConfigured() && Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function getAuth() {
  if (!instance) {
    instance = createAuth({
      db: getDb(),
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

/** The signed-in user from a session cookie or an extension bearer token (D-128). */
export async function getSessionUser(headers: Headers): Promise<{ id: string } | null> {
  if (!isAuthConfigured()) return null;
  const session = await getAuth().api.getSession({ headers });
  return session ? { id: session.user.id } : null;
}
