import "server-only";
import { createDb, requireDatabaseUrl, type Database } from "@kasa/db";

let database: Database | undefined;

/** One connection pool per server process. */
export function getDb(): Database {
  database ??= createDb(requireDatabaseUrl()).db;
  return database;
}
