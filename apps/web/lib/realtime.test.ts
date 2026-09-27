import { randomUUID } from "node:crypto";
import { eq, schema } from "@kasa/db";
import { createTestDatabase, type TestDatabase } from "@kasa/db/testing";
import { verifyTicket } from "@kasa/shared/realtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEntry, deleteEntry, listChanges, listEntries, setReaction } from "./entries";
import { realtimeConfig, realtimeTicket } from "./realtime";

describe("realtimeConfig", () => {
  it("needs both the secret and the public URL", () => {
    expect(realtimeConfig({ REALTIME_SECRET: "s", REALTIME_PUBLIC_URL: "ws://x" })).toEqual({ secret: "s", url: "ws://x" });
    expect(realtimeConfig({ REALTIME_SECRET: "s" })).toBeNull();
    expect(realtimeConfig({ REALTIME_PUBLIC_URL: "ws://x" })).toBeNull();
  });
});

describe.skipIf(!process.env.DATABASE_URL)("live updates", () => {
  let testDb: TestDatabase;
  const u = { owner: randomUUID(), viewer: randomUUID(), outsider: randomUUID() };
  const projectId = randomUUID();
  const db = () => testDb.db;
  const config = { secret: "test-secret", url: "ws://localhost:3200" };

  beforeAll(async () => {
    testDb = await createTestDatabase(process.env.DATABASE_URL!);
    await db().insert(schema.users).values(Object.entries(u).map(([name, id]) => ({ id, name, email: `${name}-${id}@example.com` })));
    await db().insert(schema.projects).values({ id: projectId, name: "Trip", ownerId: u.owner });
    await db()
      .insert(schema.memberships)
      .values([
        { projectId, userId: u.owner, role: "owner" },
        { projectId, userId: u.viewer, role: "viewer" },
      ]);
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  it("signs a ticket for members only, bound to the user and project", async () => {
    const res = await realtimeTicket(db(), config, u.viewer, projectId);
    if (!res.ok) throw new Error(res.error);
    expect(res.value.url).toBe(config.url);
    expect(verifyTicket(config.secret, res.value.ticket)).toEqual({ projectId, userId: u.viewer });
    expect(await realtimeTicket(db(), config, u.outsider, projectId)).toMatchObject({ ok: false, status: 404 });
    expect(await realtimeTicket(db(), config, u.owner, "nope")).toMatchObject({ ok: false, status: 404 });
    expect(await realtimeTicket(db(), null, u.owner, projectId)).toMatchObject({ ok: false, status: 503 });
  });

  it("lists new entries, reactions, and deletions since the last sync", async () => {
    const first = await listEntries(db(), u.viewer, projectId);
    if (!first.ok) throw new Error(first.error);
    const older = await createEntry(db(), u.owner, projectId, { text: "older" });
    if (!older.ok) throw new Error(older.error);
    // Push "older" out of the overlap window, as if it changed long ago.
    await db().execute(`update entries set updated_at = now() - interval '1 minute' where id = '${older.value.id}'`);
    const since = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 10));

    const added = await createEntry(db(), u.owner, projectId, { text: "new one" });
    const reacted = await createEntry(db(), u.owner, projectId, { text: "react here" });
    const gone = await createEntry(db(), u.owner, projectId, { text: "delete me" });
    if (!added.ok || !reacted.ok || !gone.ok) throw new Error("post failed");
    await setReaction(db(), u.owner, reacted.value.id, { emoji: "🎉" }, true);
    await deleteEntry(db(), u.owner, gone.value.id);

    const changes = await listChanges(db(), u.viewer, projectId, since);
    if (!changes.ok) throw new Error(changes.error);
    expect(changes.value.truncated).toBe(false);
    expect(changes.value.entries.map((e) => e.body ?? (e.deleted ? "(deleted)" : ""))).toEqual(["new one", "react here", "(deleted)"]);
    expect(changes.value.entries[1]!.reactions).toEqual([{ emoji: "🎉", count: 1, mine: false }]);
    expect(new Date(changes.value.syncedAt).getTime()).toBeGreaterThan(new Date(since).getTime());

    // Nothing new since the last sync, apart from the overlap window.
    const again = await listChanges(db(), u.viewer, projectId, changes.value.syncedAt);
    if (!again.ok) throw new Error(again.error);
    expect(again.value.entries.every((e) => e.id !== older.value.id)).toBe(true);
  });

  it("is for members only and validates since", async () => {
    expect(await listChanges(db(), u.outsider, projectId, new Date().toISOString())).toMatchObject({ ok: false, status: 404 });
    expect(await listChanges(db(), u.viewer, projectId, "yesterday")).toMatchObject({ ok: false, status: 400 });
    expect(await listChanges(db(), u.viewer, projectId, undefined)).toMatchObject({ ok: false, status: 400 });
  });

  it("asks for a reload when too much changed", async () => {
    const since = new Date(Date.now() - 1000).toISOString();
    await db()
      .insert(schema.entries)
      .values(Array.from({ length: 101 }, (_, i) => ({ projectId, authorId: u.owner, kind: "note" as const, body: `bulk ${i}` })));
    expect(await listChanges(db(), u.viewer, projectId, since)).toMatchObject({ ok: true, value: { entries: [], truncated: true } });
    await db().delete(schema.entries).where(eq(schema.entries.projectId, projectId));
  });
});
