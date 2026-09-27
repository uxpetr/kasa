import { randomUUID } from "node:crypto";
import { and, eq, schema } from "@kasa/db";
import { createTestDatabase, type TestDatabase } from "@kasa/db/testing";
import { setAnalyticsSink, type TrackedEvent } from "@kasa/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createEntry, listEntries, markRead, soleUrl, uploadStatus } from "./entries";
import { listMembers } from "./projects";

describe("soleUrl (D-149)", () => {
  it.each([
    ["https://www.booking.com/hotel/jp/x.html", "https://www.booking.com/hotel/jp/x.html"],
    ["http://example.com", "http://example.com/"],
    ["look at https://example.com", null],
    ["https://example.com and more", null],
    ["javascript:alert(1)", null],
    ["ftp://example.com/file", null],
    ["example.com", null],
  ])("%s", (text, expected) => {
    expect(soleUrl(text)).toBe(expected);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("entries", () => {
  let testDb: TestDatabase;
  const events: TrackedEvent[] = [];
  let restoreSink: () => void;
  const u = { owner: randomUUID(), editor: randomUUID(), viewer: randomUUID(), outsider: randomUUID() };
  const projectId = randomUUID();
  const db = () => testDb.db;

  beforeAll(async () => {
    testDb = await createTestDatabase(process.env.DATABASE_URL!);
    await db().insert(schema.users).values(Object.entries(u).map(([name, id]) => ({ id, name, email: `${name}-${id}@example.com` })));
    await db().insert(schema.projects).values({ id: projectId, name: "Trip", ownerId: u.owner });
    await db()
      .insert(schema.memberships)
      .values([
        { projectId, userId: u.owner, role: "owner" },
        { projectId, userId: u.editor, role: "editor" },
        { projectId, userId: u.viewer, role: "viewer" },
      ]);
    restoreSink = setAnalyticsSink((e) => {
      events.push(e);
    });
  });

  afterAll(async () => {
    restoreSink?.();
    await testDb?.drop();
  });

  beforeEach(() => {
    events.length = 0;
  });

  /** A processed upload owned by `userId`, as the worker leaves it. */
  async function readyUpload(userId = u.editor, overrides: Partial<typeof schema.uploads.$inferInsert> = {}) {
    const [row] = await db()
      .insert(schema.uploads)
      .values({ projectId, uploaderId: userId, contentType: "image/jpeg", size: 10, status: "ready", fullKey: `k/${randomUUID()}.jpg`, width: 800, height: 600, ...overrides })
      .returning();
    return row!.id;
  }

  describe("createEntry", () => {
    it("posts a note and emits entry_created with kind and source only", async () => {
      const res = await createEntry(db(), u.editor, projectId, { text: "  Ramen at Fuunji?  " });
      expect(res).toMatchObject({ ok: true, value: { kind: "note", body: "Ramen at Fuunji?", author: { id: u.editor, name: "editor" } } });
      expect(events).toEqual([expect.objectContaining({ event: "entry_created", userId: u.editor, properties: { projectId, kind: "note", source: "app" } })]);
    });

    it("turns a message that is only a URL into a link entry (D-149)", async () => {
      const res = await createEntry(db(), u.owner, projectId, { text: "https://www.booking.com/hotel/jp/gracery.html" });
      expect(res).toMatchObject({ ok: true, value: { kind: "link", body: null, link: { url: "https://www.booking.com/hotel/jp/gracery.html", title: null } } });
      const withText = await createEntry(db(), u.owner, projectId, { text: "this one https://example.com" });
      expect(withText).toMatchObject({ value: { kind: "note", link: null } });
    });

    it("makes one photo entry from several images with the text as caption (D-150)", async () => {
      const a = await readyUpload();
      const b = await readyUpload();
      const res = await createEntry(db(), u.editor, projectId, { text: "Kyoto lanes", uploadIds: [a, b] });
      expect(res).toMatchObject({
        ok: true,
        value: {
          kind: "photo",
          body: "Kyoto lanes",
          photos: [
            { uploadId: a, width: 800, height: 600 },
            { uploadId: b, width: 800, height: 600 },
          ],
        },
      });
      // An image can't be posted twice.
      expect(await createEntry(db(), u.editor, projectId, { uploadIds: [a] })).toMatchObject({ ok: false, status: 409 });
    });

    it("lets only one of two simultaneous sends use the same image", async () => {
      const id = await readyUpload();
      const results = await Promise.all([
        createEntry(db(), u.editor, projectId, { uploadIds: [id] }),
        createEntry(db(), u.editor, projectId, { uploadIds: [id] }),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.find((r) => !r.ok)).toMatchObject({ status: 409 });
    });

    it("refuses someone else's, unfinished, failed, or other-project uploads", async () => {
      const otherProject = randomUUID();
      await db().insert(schema.projects).values({ id: otherProject, name: "Other", ownerId: u.editor });
      for (const id of [
        await readyUpload(u.owner),
        await readyUpload(u.editor, { status: "processing", fullKey: null }),
        await readyUpload(u.editor, { status: "failed", fullKey: null }),
        await readyUpload(u.editor, { projectId: otherProject }),
        randomUUID(),
      ]) {
        expect(await createEntry(db(), u.editor, projectId, { uploadIds: [id] })).toMatchObject({ ok: false, status: 409 });
      }
      expect(events).toHaveLength(0);
    });

    it("validates the body", async () => {
      expect(await createEntry(db(), u.editor, projectId, {})).toMatchObject({ status: 400 });
      expect(await createEntry(db(), u.editor, projectId, { text: "   " })).toMatchObject({ status: 400 });
      expect(await createEntry(db(), u.editor, projectId, { text: 5 })).toMatchObject({ status: 400 });
      expect(await createEntry(db(), u.editor, projectId, { text: "x".repeat(4001) })).toMatchObject({ status: 400 });
      expect(await createEntry(db(), u.editor, projectId, { uploadIds: ["nope"] })).toMatchObject({ status: 400 });
      const id = await readyUpload();
      expect(await createEntry(db(), u.editor, projectId, { uploadIds: [id, id] })).toMatchObject({ status: 400 });
      expect(await createEntry(db(), u.editor, projectId, { uploadIds: Array.from({ length: 11 }, () => randomUUID()) })).toMatchObject({ status: 400 });
    });

    it("lets viewers read but not post, hides the project from outsiders, and freezes archived projects", async () => {
      expect(await createEntry(db(), u.viewer, projectId, { text: "hi" })).toMatchObject({ ok: false, status: 403 });
      expect(await createEntry(db(), u.outsider, projectId, { text: "hi" })).toMatchObject({ ok: false, status: 404 });
      expect(await listEntries(db(), u.viewer, projectId)).toMatchObject({ ok: true });
      expect(await listEntries(db(), u.outsider, projectId)).toMatchObject({ ok: false, status: 404 });

      await db().update(schema.projects).set({ archivedAt: new Date() }).where(eq(schema.projects.id, projectId));
      try {
        expect(await createEntry(db(), u.owner, projectId, { text: "hi" })).toMatchObject({ ok: false, status: 403 });
        expect(await listEntries(db(), u.editor, projectId)).toMatchObject({ ok: true });
      } finally {
        await db().update(schema.projects).set({ archivedAt: null }).where(eq(schema.projects.id, projectId));
      }
    });
  });

  describe("listEntries", () => {
    it("pages back through history, oldest first within a page, without gaps or repeats", async () => {
      const pid = randomUUID();
      await db().insert(schema.projects).values({ id: pid, name: "Paging", ownerId: u.owner });
      await db().insert(schema.memberships).values({ projectId: pid, userId: u.owner, role: "owner" });
      const t0 = Date.now() - 100_000;
      // 65 entries, with a tie on createdAt to exercise the id tiebreak.
      await db()
        .insert(schema.entries)
        .values(Array.from({ length: 65 }, (_, i) => ({ projectId: pid, authorId: u.owner, kind: "note" as const, body: `n${i}`, createdAt: new Date(t0 + Math.floor(i / 2) * 1000) })));
      await db().insert(schema.entries).values({ projectId: pid, authorId: u.owner, kind: "note", body: "gone", deletedAt: new Date() });

      const seen: string[] = [];
      let before: string | undefined;
      for (let i = 0; i < 5; i++) {
        const page = await listEntries(db(), u.owner, pid, { before });
        if (!page.ok) throw new Error(page.error);
        const times = page.value.entries.map((e) => e.createdAt);
        expect([...times].sort()).toEqual(times);
        seen.unshift(...page.value.entries.map((e) => e.body!));
        if (!page.value.nextCursor) break;
        before = page.value.nextCursor;
      }
      expect(seen).toHaveLength(65);
      expect(new Set(seen).size).toBe(65);
      expect(seen).not.toContain("gone");
      expect(seen.at(-1)).toBe("n64");
    });

    it("rejects malformed cursors", async () => {
      expect(await listEntries(db(), u.owner, projectId, { before: "yesterday" })).toMatchObject({ ok: false, status: 400 });
    });
  });

  describe("markRead and members", () => {
    it("records when the member read the feed, and never moves it back", async () => {
      expect(await markRead(db(), u.viewer, projectId)).toEqual({ ok: true, value: { ok: true } });
      const read = async () =>
        (await db().select({ at: schema.memberships.lastReadAt }).from(schema.memberships).where(and(eq(schema.memberships.projectId, projectId), eq(schema.memberships.userId, u.viewer))))[0]!.at!;
      const first = await read();
      expect(Date.now() - first.getTime()).toBeLessThan(10_000);
      await db().update(schema.memberships).set({ lastReadAt: new Date(Date.now() + 60_000) }).where(eq(schema.memberships.userId, u.viewer));
      const future = await read();
      await markRead(db(), u.viewer, projectId);
      expect(await read()).toEqual(future);
      expect(await markRead(db(), u.outsider, projectId)).toMatchObject({ ok: false, status: 404 });
    });

    it("lists members owner first, for members only", async () => {
      const res = await listMembers(db(), u.viewer, projectId);
      expect(res).toMatchObject({ ok: true, value: { members: [{ role: "owner" }, { role: "editor" }, { role: "viewer" }] } });
      expect(await listMembers(db(), u.outsider, projectId)).toMatchObject({ ok: false, status: 404 });
    });

    it("shows upload progress to the uploader only", async () => {
      const id = await readyUpload(u.editor, { status: "processing", fullKey: null });
      expect(await uploadStatus(db(), u.editor, id)).toEqual({ ok: true, value: { status: "processing" } });
      expect(await uploadStatus(db(), u.owner, id)).toMatchObject({ ok: false, status: 404 });
    });
  });
});
