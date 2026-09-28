import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>["db"];

/**
 * Neon's pooled hosts ("…-pooler.…") run PgBouncer in transaction mode, where named prepared
 * statements can land on another server connection; postgres.js must not prepare there (F-09).
 */
export function isPooledUrl(url: string): boolean {
  try {
    return new URL(url).hostname.includes("-pooler.");
  } catch {
    return false;
  }
}

export function createDb(url: string, options: { max?: number } = {}) {
  const sql = postgres(url, { max: options.max ?? 10, onnotice: () => {}, prepare: !isPooledUrl(url) });
  return { db: drizzle(sql, { schema }), close: () => sql.end() };
}

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  return url;
}

/**
 * A direct (unpooled) connection, for migrations and LISTEN. On Vercel the Neon integration
 * sets DATABASE_URL_UNPOOLED next to the pooled DATABASE_URL; locally they're the same.
 */
export function directDatabaseUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.DATABASE_URL_UNPOOLED || env.DATABASE_URL || undefined;
}
