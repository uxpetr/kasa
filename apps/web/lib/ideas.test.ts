import { randomUUID } from "node:crypto";
import { eq, schema } from "@kasa/db";
import { createTestDatabase, type TestDatabase } from "@kasa/db/testing";
import type { JobQueue } from "@kasa/jobs";
import { setAnalyticsSink, type TrackedEvent } from "@kasa/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteEntry, entryImageKey, listEntries } from "./entries";
import { addIdea, moreIdeas } from "./ideas";

describe.skipIf(!process.env.DATABASE_URL)("Kasa Bot ideas (P-20, D-204)", () => {
  let testDb: TestDatabase;
  const db = () => testDb.db;
  const u = { owner: randomUUID(), editor: randomUUID(), viewer: randomUUID(), outsider: randomUUID() };
  let pile: string;
  let question: string;
  let card: string;
  let food: string;
  const sent: { name: string; payload: unknown }[] = [];
  const queue: JobQueue = { send: async (name, payload) => void sent.push({ name, payload }) };
  const events: TrackedEvent[] = [];
  let restoreSink: () => void;

  async function idea(position: number, extra: Partial<typeof schema.botIdeas.$inferInsert> = {}) {
    const [row] = await db()
      .insert(schema.botIdeas)
      .values({ entryId: card, position, url: `https://example.com/${position}`, title: `Idea ${position}`, note: "Near Gion", siteName: "Tabelog", imageKey: `projects/${pile}/ideas/${position}.webp`, ...extra })
      .returning();
    return row!;
  }
  const feed = async (userId = u.owner) => {
    const page = await listEntries(db(), userId, pile);
    if (!page.ok) throw new Error(page.error);
    return page.value.entries;
  };

  beforeAll(async () => {
    testDb = await createTestDatabase(process.env.DATABASE_URL!);
    await db().insert(schema.users).values(Object.entries(u).map(([name, id]) => ({ id, name, email: `${name}-${id}@example.com` })));
    restoreSink = setAnalyticsSink((e) => void events.push(e));
  });

  beforeEach(async () => {
    sent.length = 0;
    events.length = 0;
    pile = randomUUID();
    await db().insert(schema.projects).values({ id: pile, name: "Kyoto", ownerId: u.owner });
    await db()
      .insert(schema.memberships)
      .values([
        { projectId: pile, userId: u.owner, role: "owner" },
        { projectId: pile, userId: u.editor, role: "editor" },
        { projectId: pile, userId: u.viewer, role: "viewer" },
      ]);
    const [q] = await db().insert(schema.entries).values({ projectId: pile, authorId: u.editor, kind: "note", body: "@kasa suggest dinner spots" }).returning();
    question = q!.id;
    const [c] = await db().insert(schema.entries).values({ projectId: pile, authorId: null, kind: "bot", replyToId: question, body: "Three spots:" }).returning();
    card = c!.id;
    const [f] = await db().insert(schema.categories).values({ projectId: pile, name: "Food", createdBy: "bot" }).returning();
    food = f!.id;
  });

  afterAll(async () => {
    restoreSink?.();
    await testDb?.drop();
  });

  it("shows the ideas on the answer card, to viewers too", async () => {
    await idea(0, { category: "Food" });
    await idea(1, { imageKey: null });
    const shown = (await feed(u.viewer)).find((e) => e.id === card)!;
    expect(shown.ideas).toEqual([
      { id: expect.any(String), url: "https://example.com/0", title: "Idea 0", note: "Near Gion", siteName: "Tabelog", hasImage: true, added: null },
      { id: expect.any(String), url: "https://example.com/1", title: "Idea 1", note: "Near Gion", siteName: "Tabelog", hasImage: false, added: null },
    ]);
  });

  it("adds an idea as the member's link, filed into its category, once", async () => {
    const i = await idea(0, { category: "food" });
    const added = await addIdea(db(), u.editor, i.id, queue);
    if (!added.ok) throw new Error(added.error);
    expect(added.value).toMatchObject({
      kind: "link",
      author: { id: u.editor },
      fromBot: true,
      link: { url: "https://example.com/0", title: "Idea 0", siteName: "Tabelog", hasImage: true },
      categories: [{ id: food, name: "Food" }],
    });
    // The picture is the idea's own; the link isn't unfurled or sorted again.
    expect(await entryImageKey(db(), u.viewer, added.value.id, "preview")).toBe(`projects/${pile}/ideas/0.webp`);
    expect(sent).toEqual([]);
    const [row] = await db().select().from(schema.entries).where(eq(schema.entries.id, added.value.id));
    expect(row).toMatchObject({ suggestedBy: card, source: "app" });
    expect(row!.sortedAt).not.toBeNull();
    expect((await feed()).find((e) => e.id === card)!.ideas[0]!.added).toEqual({ entryId: added.value.id, category: "Food" });
    expect(events.map((e) => e.event)).toEqual(["entry_created", "idea_added"]);

    // A second click, by anyone, gets the same link.
    const again = await addIdea(db(), u.owner, i.id, queue);
    expect(again.ok && again.value.id).toBe(added.value.id);
    expect((await feed()).filter((e) => e.kind === "link")).toHaveLength(1);
  });

  it("leaves an idea whose category is gone for Kasa Bot to sort", async () => {
    const i = await idea(0, { category: "Nightlife" });
    const added = await addIdea(db(), u.owner, i.id, queue);
    expect(added.ok && added.value.categories).toEqual([]);
    expect(sent.map((s) => s.name)).toEqual(["bot.sort"]);
    expect((await feed()).find((e) => e.id === card)!.ideas[0]!.added).toMatchObject({ category: null });
  });

  it("makes a deleted link's idea addable again", async () => {
    const i = await idea(0);
    const added = await addIdea(db(), u.editor, i.id, queue);
    if (!added.ok) throw new Error(added.error);
    await deleteEntry(db(), u.editor, added.value.id);
    expect((await feed()).find((e) => e.id === card)!.ideas[0]!.added).toBeNull();
    const again = await addIdea(db(), u.editor, i.id, queue);
    expect(again.ok && again.value.id).not.toBe(added.value.id);
  });

  it("refuses viewers, outsiders, archived piles, and ideas on deleted cards", async () => {
    const i = await idea(0);
    expect(await addIdea(db(), u.viewer, i.id, queue)).toMatchObject({ ok: false, status: 403 });
    expect(await addIdea(db(), u.outsider, i.id, queue)).toMatchObject({ ok: false, status: 404 });
    expect(await addIdea(db(), u.owner, "not-a-uuid", queue)).toMatchObject({ ok: false, status: 404 });
    expect(await entryImageKey(db(), u.outsider, card, { ideaId: i.id })).toBeNull();
    expect(await entryImageKey(db(), u.viewer, card, { ideaId: i.id })).toBe(`projects/${pile}/ideas/0.webp`);
    await db().update(schema.projects).set({ archivedAt: new Date() }).where(eq(schema.projects.id, pile));
    expect(await addIdea(db(), u.owner, i.id, queue)).toMatchObject({ ok: false, status: 403 });
    await db().update(schema.projects).set({ archivedAt: null }).where(eq(schema.projects.id, pile));
    await db().update(schema.entries).set({ deletedAt: new Date() }).where(eq(schema.entries.id, card));
    expect(await addIdea(db(), u.owner, i.id, queue)).toMatchObject({ ok: false, status: 404 });
  });

  it("asks for more ideas with a new card on the same question, once at a time", async () => {
    await idea(0);
    const more = await moreIdeas(db(), u.editor, card, queue);
    if (!more.ok) throw new Error(more.error);
    expect(more.value).toMatchObject({ kind: "bot", botCard: "pending", replyTo: { id: question } });
    expect(sent).toEqual([{ name: "bot.answer", payload: { entryId: more.value.id } }]);
    const twice = await moreIdeas(db(), u.owner, card, queue);
    expect(twice.ok && twice.value.id).toBe(more.value.id);
    expect(sent).toHaveLength(1);
  });

  it("offers more ideas only on answers with ideas, to people who can add, with the bot on", async () => {
    expect(await moreIdeas(db(), u.editor, card, queue)).toMatchObject({ ok: false, status: 404 });
    await idea(0);
    expect(await moreIdeas(db(), u.viewer, card, queue)).toMatchObject({ ok: false, status: 403 });
    expect(await moreIdeas(db(), u.outsider, card, queue)).toMatchObject({ ok: false, status: 404 });
    expect(await moreIdeas(db(), u.editor, card, undefined)).toMatchObject({ ok: false, status: 409 });
    await db().update(schema.projects).set({ botMode: "off" }).where(eq(schema.projects.id, pile));
    expect(await moreIdeas(db(), u.editor, card, queue)).toMatchObject({ ok: false, status: 409 });
    expect(sent).toEqual([]);
  });
});
