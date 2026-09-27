import { randomUUID } from "node:crypto";
import { eq, schema } from "@kasa/db";
import { createTestDatabase, type TestDatabase } from "@kasa/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listPiles } from "./piles";
import { previewLine, type LastEntry } from "./preview";

describe("previewLine (D-145)", () => {
  const me = "me";
  const entry = (e: Partial<LastEntry>): LastEntry => ({
    kind: "note",
    body: null,
    authorId: "mika",
    authorName: "Mika Tanaka",
    linkTitle: null,
    pageUrl: null,
    ...e,
  });

  it.each([
    [entry({ body: "Yes! Let's make it  our first\nevening." }), "Mika: Yes! Let's make it our first evening."],
    [entry({ authorId: me, body: "Two venues left." }), "You: Two venues left."],
    [entry({ kind: "bot", authorId: null, authorName: null, body: "Sorted 12 sources." }), "Kasa Bot: Sorted 12 sources."],
    [entry({ kind: "photo" }), "Mika: Photo"],
    [entry({ kind: "link", linkTitle: "Hotel Gracery Shinjuku" }), "Mika: Link · Hotel Gracery Shinjuku"],
    [entry({ kind: "link" }), "Mika: Link"],
    [entry({ kind: "capture", pageUrl: "https://www.booking.com/hotel/jp/x.html" }), "Mika: Capture from booking.com"],
    [entry({ kind: "capture", pageUrl: "not a url" }), "Mika: Capture"],
    [entry({ kind: "drawing", pageUrl: "https://example.com/a" }), "Mika: Drawing on example.com"],
    [entry({ kind: "file" }), "Mika: File"],
    [entry({ authorId: null, authorName: null, body: "From someone who deleted their account" }), "From someone who deleted their account"],
  ])("%#: %s", (e, expected) => {
    expect(previewLine(e, me)).toBe(expected);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("listPiles", () => {
  let testDb: TestDatabase;
  const storage = { presignDownload: async (key: string) => `https://signed.example/${key}` };
  const u = { me: randomUUID(), mika: randomUUID(), outsider: randomUUID() };
  const p = { trip: randomUUID(), solo: randomUUID(), empty: randomUUID(), other: randomUUID() };
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

  beforeAll(async () => {
    testDb = await createTestDatabase(process.env.DATABASE_URL!);
    const db = testDb.db;
    await db.insert(schema.users).values([
      { id: u.me, name: "Petr A", email: `me-${u.me}@example.com` },
      { id: u.mika, name: "Mika Tanaka", email: `mika-${u.mika}@example.com` },
      { id: u.outsider, name: "Out", email: `out-${u.outsider}@example.com` },
    ]);
    await db.insert(schema.projects).values([
      { id: p.trip, name: "Japan 2027", ownerId: u.me, createdAt: minutesAgo(600) },
      { id: p.solo, name: "My pile", ownerId: u.me, createdAt: minutesAgo(600) },
      { id: p.empty, name: "Empty", ownerId: u.me, createdAt: minutesAgo(30) },
      { id: p.other, name: "Not mine", ownerId: u.outsider },
    ]);
    await db.insert(schema.memberships).values([
      { projectId: p.trip, userId: u.me, role: "owner", joinedAt: minutesAgo(600), lastReadAt: minutesAgo(100) },
      { projectId: p.trip, userId: u.mika, role: "editor", joinedAt: minutesAgo(500) },
      { projectId: p.solo, userId: u.me, role: "owner", joinedAt: minutesAgo(600) },
      { projectId: p.empty, userId: u.me, role: "owner", joinedAt: minutesAgo(30) },
      { projectId: p.other, userId: u.outsider, role: "owner" },
    ]);
    const [, , , , photo] = await db
      .insert(schema.entries)
      .values([
        // Read: before lastReadAt.
        { projectId: p.trip, authorId: u.mika, kind: "note", body: "old", createdAt: minutesAgo(200) },
        // Unread for me: by Mika and the bot after lastReadAt (the photo below too).
        { projectId: p.trip, authorId: u.mika, kind: "note", body: "new 1", createdAt: minutesAgo(50) },
        { projectId: p.trip, authorId: null, kind: "bot", body: "bot tip", createdAt: minutesAgo(40) },
        // Mine: never unread.
        { projectId: p.trip, authorId: u.me, kind: "note", body: "mine", createdAt: minutesAgo(30) },
        // Last entry: a photo by Mika.
        { projectId: p.trip, authorId: u.mika, kind: "photo", createdAt: minutesAgo(10) },
        // Deleted: ignored everywhere.
        { projectId: p.trip, authorId: u.mika, kind: "note", body: "deleted", createdAt: minutesAgo(5), deletedAt: minutesAgo(4) },
        { projectId: p.solo, authorId: u.me, kind: "note", body: "saved 1", createdAt: minutesAgo(300) },
        { projectId: p.solo, authorId: u.me, kind: "note", body: "saved 2", createdAt: minutesAgo(290) },
        { projectId: p.other, authorId: u.outsider, kind: "note", body: "secret" },
      ])
      .returning();
    await db.insert(schema.entryMedia).values({ entryId: photo!.id, storageKey: "projects/x/media/y/full.jpg", role: "photo" });
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  it("returns only the user's projects, most recent activity first", async () => {
    const piles = await listPiles({ db: testDb.db, storage }, u.me);
    expect(piles.map((x) => x.name)).toEqual(["Japan 2027", "Empty", "My pile"]);
    expect(JSON.stringify(piles)).not.toContain("secret");
  });

  it("counts unread entries by others since the last read, ignoring deleted ones", async () => {
    const [trip] = await listPiles({ db: testDb.db, storage }, u.me);
    // The bot tip is unread but not a thing saved.
    expect(trip).toMatchObject({ unread: 3, entryCount: 4 });
  });

  it("counts from joining when the member has never opened the feed", async () => {
    const piles = await listPiles({ db: testDb.db, storage }, u.mika);
    // Mika wrote most of it; only the bot tip and Petr's note are by others after she joined.
    expect(piles.find((x) => x.id === p.trip)).toMatchObject({ unread: 2 });
  });

  it("words the last entry, signs its image, and lists members in join order", async () => {
    const [trip] = await listPiles({ db: testDb.db, storage }, u.me);
    expect(trip).toMatchObject({
      preview: "Mika: Photo",
      peekUrl: "https://signed.example/projects/x/media/y/full.jpg",
      members: [
        { id: u.me, name: "Petr A" },
        { id: u.mika, name: "Mika Tanaka" },
      ],
    });
  });

  it("handles empty and personal projects", async () => {
    const piles = await listPiles({ db: testDb.db, storage }, u.me);
    expect(piles.find((x) => x.id === p.empty)).toMatchObject({ preview: null, peekUrl: null, unread: 0, entryCount: 0, memberCount: 1 });
    expect(piles.find((x) => x.id === p.solo)).toMatchObject({ preview: "You: saved 2", entryCount: 2, memberCount: 1 });
  });

  it("leaves out deleted projects", async () => {
    await testDb.db.update(schema.projects).set({ deletedAt: new Date() }).where(eq(schema.projects.id, p.empty));
    expect((await listPiles({ db: testDb.db, storage }, u.me)).map((x) => x.id)).not.toContain(p.empty);
  });
});
