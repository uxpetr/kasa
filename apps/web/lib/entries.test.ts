import { randomUUID } from "node:crypto";
import { and, eq, schema } from "@kasa/db";
import { createTestDatabase, type TestDatabase } from "@kasa/db/testing";
import type { JobQueue } from "@kasa/jobs";
import { setAnalyticsSink, type TrackedEvent } from "@kasa/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FeedEntry } from "./entries";
import { createEntry, deleteEntry, entryImageKey, listEntries, markRead, setReaction, soleUrl, uploadStatus } from "./entries";
import { mediaUrl } from "./uploads";
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
    it("posts a note and emits entry_created with ids, kind, and source only", async () => {
      const res = await createEntry(db(), u.editor, projectId, { text: "  Ramen at Fuunji?  " });
      expect(res).toMatchObject({ ok: true, value: { kind: "note", body: "Ramen at Fuunji?", author: { id: u.editor, name: "editor" } } });
      const entryId = res.ok ? res.value.id : "";
      expect(events).toEqual([expect.objectContaining({ event: "entry_created", userId: u.editor, properties: { projectId, entryId, kind: "note", source: "app" } })]);
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

  describe("asking Kasa Bot (P-17)", () => {
    const sent: { name: string; payload: unknown }[] = [];
    const queue: JobQueue = { send: async (name, payload) => void sent.push({ name, payload }) };
    beforeEach(() => {
      sent.length = 0;
    });
    const botReplies = (questionId: string) =>
      db().select().from(schema.entries).where(and(eq(schema.entries.replyToId, questionId), eq(schema.entries.kind, "bot")));

    it("makes a pending bot reply after the question and queues bot.answer", async () => {
      const res = await createEntry(db(), u.editor, projectId, { text: "@kasa which of these is closest to Gion?" }, queue);
      const questionId = res.ok ? res.value.id : "";
      const [bot, ...rest] = await botReplies(questionId);
      expect(rest).toHaveLength(0);
      expect(bot).toMatchObject({ projectId, authorId: null, kind: "bot", body: null, botCard: "pending" });
      // What the bot will read: this pile's live entries, including the question, but no unfinished bot cards (D-199).
      const readable = (await db().select().from(schema.entries).where(eq(schema.entries.projectId, projectId))).filter(
        (e) => !e.deletedAt && (e.kind !== "bot" || e.botCard === null),
      );
      expect(bot!.botEntriesRead).toBe(readable.length);
      const [question] = await db().select().from(schema.entries).where(eq(schema.entries.id, questionId));
      expect(bot!.createdAt.getTime()).toBeGreaterThanOrEqual(question!.createdAt.getTime());
      expect(sent).toContainEqual({ name: "bot.answer", payload: { entryId: bot!.id } });
      // The bot's card isn't a person's post, so it isn't tracked as one (G1 counts people).
      expect(events.map((e) => e.event)).toEqual(["entry_created"]);
    });

    it("counts a typed @kasa in any case, and a photo caption, but not an email address or a longer name", async () => {
      for (const text of ["Hey @Kasa, any tips?", "(@kasa) ideas?", "@KASA"]) {
        const res = await createEntry(db(), u.editor, projectId, { text }, queue);
        expect(await botReplies(res.ok ? res.value.id : "")).toHaveLength(1);
      }
      const photo = await createEntry(db(), u.editor, projectId, { text: "@kasa where is this?", uploadIds: [await readyUpload()] }, queue);
      expect(await botReplies(photo.ok ? photo.value.id : "")).toHaveLength(1);
      for (const text of ["mail hello@kasa.com", "@kasabot hi", "@kasa_x hi", "kasa, hi"]) {
        const res = await createEntry(db(), u.editor, projectId, { text }, queue);
        expect(await botReplies(res.ok ? res.value.id : "")).toHaveLength(0);
      }
      expect(sent.filter((j) => j.name === "bot.answer")).toHaveLength(4);
    });

    it("stays quiet when the pile turned Kasa Bot off", async () => {
      await db().update(schema.projects).set({ botMode: "off" }).where(eq(schema.projects.id, projectId));
      try {
        const res = await createEntry(db(), u.editor, projectId, { text: "@kasa hello?" }, queue);
        expect(await botReplies(res.ok ? res.value.id : "")).toHaveLength(0);
        expect(sent).toHaveLength(0);
      } finally {
        await db().update(schema.projects).set({ botMode: "tagged" }).where(eq(schema.projects.id, projectId));
      }
    });

    it("says it failed on the card when the job can't be queued", async () => {
      const broken: JobQueue = { send: async (name) => { if (name === "bot.answer") throw new Error("queue down"); } };
      const res = await createEntry(db(), u.editor, projectId, { text: "@kasa hello?" }, broken);
      expect(res.ok).toBe(true);
      expect(await botReplies(res.ok ? res.value.id : "")).toMatchObject([{ botCard: "failed" }]);
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
      const outlines: FeedEntry[] = [];
      let before: string | undefined;
      for (let i = 0; i < 5; i++) {
        const page = await listEntries(db(), u.owner, pid, { before });
        if (!page.ok) throw new Error(page.error);
        const times = page.value.entries.map((e) => e.createdAt);
        expect([...times].sort()).toEqual(times);
        seen.unshift(...page.value.entries.filter((e) => !e.deleted).map((e) => e.body!));
        outlines.push(...page.value.entries.filter((e) => e.deleted));
        if (!page.value.nextCursor) break;
        before = page.value.nextCursor;
      }
      expect(seen).toHaveLength(65);
      expect(new Set(seen).size).toBe(65);
      expect(seen.at(-1)).toBe("n64");
      // The deleted note stays as an outline, without its text (D-155).
      expect(outlines).toEqual([expect.objectContaining({ kind: "note", body: null, deleted: true, author: { id: u.owner, name: "owner" } })]);
      expect(JSON.stringify(outlines)).not.toContain("gone");
    });

    it("rejects malformed cursors", async () => {
      expect(await listEntries(db(), u.owner, projectId, { before: "yesterday" })).toMatchObject({ ok: false, status: 400 });
    });
  });

  describe("replies (D-006)", () => {
    it("posts a reply with the original attached, and emits reply_created", async () => {
      const original = await createEntry(db(), u.owner, projectId, { text: "Ryokan with a private onsen" });
      if (!original.ok) throw new Error(original.error);
      events.length = 0;
      const reply = await createEntry(db(), u.editor, projectId, { text: "Yes, book it!", replyToId: original.value.id });
      expect(reply).toMatchObject({
        ok: true,
        value: { kind: "note", body: "Yes, book it!", replyTo: { id: original.value.id, kind: "note", body: "Ryokan with a private onsen", author: { id: u.owner }, replyTo: null } },
      });
      expect(events.map((e) => e.event)).toEqual(["entry_created", "reply_created"]);
      expect(events[1]!.properties).toEqual({ projectId, entryId: reply.ok ? reply.value.id : "", replyToId: original.value.id, kind: "note", toKind: "note", own: false });

      // Replies to replies quote one level only, and the page carries the quote too.
      if (!reply.ok) throw new Error(reply.error);
      const nested = await createEntry(db(), u.owner, projectId, { text: "Done", replyToId: reply.value.id });
      expect(nested).toMatchObject({ value: { replyTo: { id: reply.value.id, replyTo: null } } });
      const page = await listEntries(db(), u.viewer, projectId);
      if (!page.ok) throw new Error(page.error);
      expect(page.value.entries.find((e) => e.id === reply.value.id)!.replyTo).toMatchObject({ id: original.value.id });
    });

    it("shows a deleted original as an outline without its text", async () => {
      const original = await createEntry(db(), u.editor, projectId, { text: "soon gone" });
      if (!original.ok) throw new Error(original.error);
      const reply = await createEntry(db(), u.owner, projectId, { text: "hmm", replyToId: original.value.id });
      if (!reply.ok) throw new Error(reply.error);
      await deleteEntry(db(), u.editor, original.value.id);
      const page = await listEntries(db(), u.owner, projectId);
      if (!page.ok) throw new Error(page.error);
      const quoted = page.value.entries.find((e) => e.id === reply.value.id)!.replyTo!;
      expect(quoted).toMatchObject({ id: original.value.id, deleted: true, body: null });
      expect(JSON.stringify(quoted)).not.toContain("soon gone");
      // And a deleted entry can't be replied to.
      expect(await createEntry(db(), u.owner, projectId, { text: "late", replyToId: original.value.id })).toMatchObject({ ok: false, status: 404 });
    });

    it("never replies across projects or quotes another project's entry", async () => {
      const other = randomUUID();
      await db().insert(schema.projects).values({ id: other, name: "Secret", ownerId: u.outsider });
      await db().insert(schema.memberships).values({ projectId: other, userId: u.outsider, role: "owner" });
      const secret = await createEntry(db(), u.outsider, other, { text: "secret plans" });
      if (!secret.ok) throw new Error(secret.error);
      expect(await createEntry(db(), u.owner, projectId, { text: "peek", replyToId: secret.value.id })).toMatchObject({ ok: false, status: 404 });
      expect(await createEntry(db(), u.owner, projectId, { text: "bad", replyToId: "nope" })).toMatchObject({ ok: false, status: 400 });

      // Even a row written straight to the database doesn't leak the other project's entry.
      const [forged] = await db().insert(schema.entries).values({ projectId, authorId: u.owner, kind: "note", body: "forged", replyToId: secret.value.id }).returning();
      const page = await listEntries(db(), u.owner, projectId);
      if (!page.ok) throw new Error(page.error);
      expect(page.value.entries.find((e) => e.id === forged!.id)!.replyTo).toBeNull();
      expect(JSON.stringify(page.value)).not.toContain("secret plans");
    });
  });

  describe("details", () => {
    it("returns capture pins, the first pin comment, the screenshot, and link images, whatever the source (D-016)", async () => {
      const pid = randomUUID();
      await db().insert(schema.projects).values({ id: pid, name: "Details", ownerId: u.owner });
      await db().insert(schema.memberships).values([{ projectId: pid, userId: u.owner, role: "owner" }]);
      const [capture, link] = await db()
        .insert(schema.entries)
        .values([
          { projectId: pid, authorId: u.owner, kind: "capture", source: "extension" },
          { projectId: pid, authorId: u.owner, kind: "link", source: "telegram" },
        ])
        .returning();
      await db().insert(schema.captures).values({ entryId: capture!.id, pageUrl: "https://example.com/tower", pageTitle: "Tower" });
      const [shot] = await db()
        .insert(schema.entryMedia)
        .values({ entryId: capture!.id, storageKey: "k/shot.jpg", role: "screenshot", width: 1440, height: 900 })
        .returning();
      const [pin1, pin2] = await db()
        .insert(schema.pins)
        .values([
          { captureEntryId: capture!.id, number: 1, x: 0.4, y: 0.3 },
          { captureEntryId: capture!.id, number: 2, x: 0.7, y: 0.2 },
        ])
        .returning();
      await db()
        .insert(schema.comments)
        .values([
          { entryId: capture!.id, pinId: pin2!.id, authorId: u.owner, body: "second pin", createdAt: new Date(Date.now() - 3000) },
          { entryId: capture!.id, pinId: pin1!.id, authorId: u.owner, body: "Go at sunset?", createdAt: new Date(Date.now() - 2000) },
          { entryId: capture!.id, pinId: pin1!.id, authorId: u.owner, body: "a later reply", createdAt: new Date(Date.now() - 1000) },
        ]);
      await db().insert(schema.linkPreviews).values({ entryId: link!.id, url: "https://example.com/a", title: "A", imageKey: "k/preview.jpg" });

      const page = await listEntries(db(), u.owner, pid);
      if (!page.ok) throw new Error(page.error);
      const byKind = Object.fromEntries(page.value.entries.map((e) => [e.kind, e]));
      expect(byKind.capture!.capture).toEqual({
        pageUrl: "https://example.com/tower",
        pageTitle: "Tower",
        screenshot: { mediaId: shot!.id, width: 1440, height: 900 },
        pins: [
          { number: 1, x: 0.4, y: 0.3 },
          { number: 2, x: 0.7, y: 0.2 },
        ],
        note: "Go at sunset?",
      });
      expect(byKind.link!.link).toEqual({ url: "https://example.com/a", title: "A", siteName: null, hasImage: true });
      expect(Object.keys(byKind.capture!).sort()).toEqual(Object.keys(byKind.link!).sort());

      expect(await entryImageKey(db(), u.owner, capture!.id, { mediaId: shot!.id })).toBe("k/shot.jpg");
      expect(await entryImageKey(db(), u.owner, link!.id, "preview")).toBe("k/preview.jpg");
      // Not across entries, not for outsiders, not once deleted.
      expect(await entryImageKey(db(), u.owner, link!.id, { mediaId: shot!.id })).toBeNull();
      expect(await entryImageKey(db(), u.outsider, capture!.id, { mediaId: shot!.id })).toBeNull();
      await db().update(schema.entries).set({ deletedAt: new Date() }).where(eq(schema.entries.id, link!.id));
      expect(await entryImageKey(db(), u.owner, link!.id, "preview")).toBeNull();
    });
  });

  describe("reactions (D-154)", () => {
    it("adds and removes the user's reactions, counts everyone's, and emits reaction_added once", async () => {
      const posted = await createEntry(db(), u.editor, projectId, { text: "Ryokan with a private onsen" });
      if (!posted.ok) throw new Error(posted.error);
      const id = posted.value.id;
      events.length = 0;

      expect(await setReaction(db(), u.owner, id, { emoji: "❤️" }, true)).toEqual({ ok: true, value: { reactions: [{ emoji: "❤️", count: 1, mine: true }] } });
      await setReaction(db(), u.owner, id, { emoji: "❤️" }, true);
      await setReaction(db(), u.editor, id, { emoji: "👀" }, true);
      expect(await setReaction(db(), u.editor, id, { emoji: "❤️" }, true)).toEqual({
        ok: true,
        value: {
          reactions: [
            { emoji: "❤️", count: 2, mine: true },
            { emoji: "👀", count: 1, mine: true },
          ],
        },
      });
      expect(events.filter((e) => e.event === "reaction_added")).toHaveLength(3);
      expect(await setReaction(db(), u.owner, id, { emoji: "❤️" }, false)).toMatchObject({ value: { reactions: [{ emoji: "❤️", count: 1, mine: false }, { emoji: "👀" }] } });

      const page = await listEntries(db(), u.viewer, projectId);
      if (!page.ok) throw new Error(page.error);
      expect(page.value.entries.find((e) => e.id === id)!.reactions).toEqual([
        { emoji: "❤️", count: 1, mine: false },
        { emoji: "👀", count: 1, mine: false },
      ]);
    });

    it("accepts only the six reactions, from owners and editors, on live entries", async () => {
      const posted = await createEntry(db(), u.editor, projectId, { text: "react to me" });
      if (!posted.ok) throw new Error(posted.error);
      const id = posted.value.id;
      for (const emoji of ["🔥", "", 1, undefined]) expect(await setReaction(db(), u.owner, id, { emoji }, true)).toMatchObject({ status: 400 });
      expect(await setReaction(db(), u.viewer, id, { emoji: "👍" }, true)).toMatchObject({ ok: false, status: 403 });
      expect(await setReaction(db(), u.outsider, id, { emoji: "👍" }, true)).toMatchObject({ ok: false, status: 404 });
      expect(await setReaction(db(), u.owner, "nope", { emoji: "👍" }, true)).toMatchObject({ ok: false, status: 404 });
      await deleteEntry(db(), u.editor, id);
      expect(await setReaction(db(), u.owner, id, { emoji: "👍" }, true)).toMatchObject({ ok: false, status: 404 });
    });
  });

  describe("deleteEntry (D-015, D-155)", () => {
    it("lets authors delete their own entries and the owner delete anyone's, the bot's included", async () => {
      const mine = await createEntry(db(), u.editor, projectId, { text: "mine" });
      const theirs = await createEntry(db(), u.owner, projectId, { text: "the owner's" });
      const byEditor = await createEntry(db(), u.editor, projectId, { text: "by the editor" });
      const [bot] = await db().insert(schema.entries).values({ projectId, authorId: null, kind: "bot", body: "tip" }).returning();
      if (!mine.ok || !theirs.ok || !byEditor.ok) throw new Error("post failed");
      events.length = 0;

      expect(await deleteEntry(db(), u.editor, mine.value.id)).toMatchObject({
        ok: true,
        value: { deleted: true, body: null, kind: "note", author: { id: u.editor }, deletedBy: { id: u.editor, name: "editor" } },
      });
      expect(events).toEqual([expect.objectContaining({ event: "entry_deleted", properties: { projectId, kind: "note", own: true } })]);
      expect(await deleteEntry(db(), u.editor, theirs.value.id)).toMatchObject({ ok: false, status: 403 });
      expect(await deleteEntry(db(), u.editor, bot!.id)).toMatchObject({ ok: false, status: 403 });
      expect(await deleteEntry(db(), u.viewer, byEditor.value.id)).toMatchObject({ ok: false, status: 403 });
      expect(await deleteEntry(db(), u.outsider, byEditor.value.id)).toMatchObject({ ok: false, status: 404 });
      expect(await deleteEntry(db(), u.owner, byEditor.value.id)).toMatchObject({ ok: true, value: { deleted: true, author: { id: u.editor }, deletedBy: { id: u.owner } } });
      expect(await deleteEntry(db(), u.owner, bot!.id)).toMatchObject({ ok: true, value: { deleted: true } });
      // Twice is fine and doesn't count again.
      expect(await deleteEntry(db(), u.editor, mine.value.id)).toMatchObject({ ok: true, value: { deleted: true } });
      expect(events.filter((e) => e.event === "entry_deleted")).toHaveLength(3);
    });

    it("hides a deleted photo's images from everyone", async () => {
      const upload = await readyUpload();
      await db().update(schema.uploads).set({ thumbKey: "k/thumb.jpg" }).where(eq(schema.uploads.id, upload));
      const posted = await createEntry(db(), u.editor, projectId, { uploadIds: [upload] });
      if (!posted.ok) throw new Error(posted.error);
      const storage = { presignDownload: async (key: string) => `signed:${key}` } as never;
      expect(await mediaUrl({ db: db(), storage }, u.viewer, upload, "thumb")).toBe("signed:k/thumb.jpg");
      await deleteEntry(db(), u.editor, posted.value.id);
      expect(await mediaUrl({ db: db(), storage }, u.viewer, upload, "thumb")).toBeNull();
      expect(await mediaUrl({ db: db(), storage }, u.editor, upload, "full")).toBeNull();
    });

    it("freezes archived projects", async () => {
      const posted = await createEntry(db(), u.owner, projectId, { text: "frozen" });
      if (!posted.ok) throw new Error(posted.error);
      await db().update(schema.projects).set({ archivedAt: new Date() }).where(eq(schema.projects.id, projectId));
      try {
        expect(await deleteEntry(db(), u.owner, posted.value.id)).toMatchObject({ ok: false, status: 403 });
        expect(await setReaction(db(), u.owner, posted.value.id, { emoji: "👍" }, true)).toMatchObject({ ok: false, status: 403 });
      } finally {
        await db().update(schema.projects).set({ archivedAt: null }).where(eq(schema.projects.id, projectId));
      }
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
      expect(events).toEqual([]);
    });

    it("emits feed_opened only when the feed first opens", async () => {
      await markRead(db(), u.viewer, projectId, true);
      expect(events).toEqual([expect.objectContaining({ event: "feed_opened", userId: u.viewer, properties: { projectId } })]);
      events.length = 0;
      await markRead(db(), u.outsider, projectId, true);
      expect(events).toEqual([]);
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
