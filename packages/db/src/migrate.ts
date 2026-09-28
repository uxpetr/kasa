import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, directDatabaseUrl } from "./client";

export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

export async function runMigrations(url: string) {
  const { db, close } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}

/**
 * `--deploy` (the Vercel build, F-09): migrate only where MIGRATE_ON_BUILD=1 is set for that
 * environment, so a preview that shares the staging database never applies an unmerged migration.
 */
export function deployDecision(env: Record<string, string | undefined>): { run: true; url: string } | { run: false; reason: string } {
  if (env.MIGRATE_ON_BUILD !== "1") return { run: false, reason: "MIGRATE_ON_BUILD is not 1 for this environment" };
  const url = directDatabaseUrl(env);
  if (!url) return { run: false, reason: "no DATABASE_URL" };
  return { run: true, url };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--deploy")) {
    const decision = deployDecision(process.env);
    if (!decision.run) {
      console.log(`migrations skipped: ${decision.reason}`);
      process.exit(0);
    }
    await runMigrations(decision.url);
  } else {
    const url = directDatabaseUrl();
    if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
    await runMigrations(url);
  }
  console.log("migrations applied");
}
