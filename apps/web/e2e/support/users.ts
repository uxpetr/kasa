import { randomBytes, randomUUID } from "node:crypto";
import { createDb, inArray, schema } from "@kasa/db";

/**
 * Test users with bearer sessions (D-128), created straight in the database.
 * The server reads `Authorization: Bearer` on page loads too, so a Playwright
 * context with that header is signed in.
 */
export async function createUsers<const N extends string>(names: N[]) {
  const conn = createDb(process.env.DATABASE_URL!);
  const users = {} as Record<N, { id: string; name: string; token: string; headers: { authorization: string } }>;
  for (const name of names) {
    const id = randomUUID();
    const token = randomBytes(24).toString("base64url");
    await conn.db.insert(schema.users).values({ id, name, email: `e2e-${name.toLowerCase()}-${id}@example.com` });
    await conn.db.insert(schema.sessions).values({ userId: id, token, expiresAt: new Date(Date.now() + 3_600_000) });
    users[name] = { id, name, token, headers: { authorization: `Bearer ${token}` } };
  }
  return {
    db: conn.db,
    users,
    /** Deletes the users and every project they own. */
    async cleanup() {
      const ids = Object.values<{ id: string }>(users).map((u) => u.id);
      await conn.db.delete(schema.projects).where(inArray(schema.projects.ownerId, ids));
      await conn.db.delete(schema.users).where(inArray(schema.users.id, ids));
      await conn.close();
    },
  };
}
