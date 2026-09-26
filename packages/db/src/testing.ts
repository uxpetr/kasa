// Test helper: a migrated throwaway database next to DATABASE_URL, dropped afterwards.
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { createDb, type Database } from "./client";
import { runMigrations } from "./migrate";

export interface TestDatabase {
  url: string;
  db: Database;
  drop: () => Promise<void>;
}

export async function createTestDatabase(baseUrl: string): Promise<TestDatabase> {
  const name = `kasa_test_${randomBytes(4).toString("hex")}`;
  const admin = postgres(baseUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  await runMigrations(url.toString());
  const { db, close } = createDb(url.toString(), { max: 2 });
  return {
    url: url.toString(),
    db,
    drop: async () => {
      await close();
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}
