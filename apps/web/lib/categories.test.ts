import { randomUUID } from "node:crypto";
import { and, eq, schema } from "@kasa/db";
import { createTestDatabase, type TestDatabase } from "@kasa/db/testing";
import type { JobQueue, SendOptions } from "@kasa/jobs";
import { MAX_CATEGORIES } from "@kasa/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { categoryName, createCategory, deleteCategory, listCategories, setEntryCategories, undoReceipt, updateCategory } from "./categories";
import { createEntry, listChanges, listEntries } from "./entries";

describe("categoryName", () => {
  it("trims, single-spaces, and refuses empty or long names", () => {
    expect(categoryName("  Getting   around ")).toBe("Getting around");
    expect(categoryName("")).toBeNull();
    expect(categoryName("x".repeat(31))).toBeNull();
    expect(categoryName(5)).toBeNull();
  });
});

describe.skipIf(!process.env.DATABASE_URL)("categories (P-19)", () => {
  let testDb: TestDatabase;
  const db = () => testDb.db;
  const u = { owner: randomUUID(), editor: randomUUID(), viewer: randomUUID(), outsider: randomUUID() };
  const other = randomUUID();
  let pile: string;
  let otherCategory: string;

  async function note(body: string, extra: Partial<typeof schema.entries.$inferInsert> = {}) {
    const [row] = await db().insert(schema.entries).values({ projectId: pile, authorId: u.editor, kind: "note", body, ...extra }).returning();
    return row!.id;
  }
  async function category(name: string, createdBy: "bot" | "user" = "bot", projectId = pile) {
    const [row] = await db().insert(schema.categories).values({ projectId, name, createdBy }).returning();
    return row!.id;
  }
  const file = (entryId: string, categoryId: string, receiptId: string | null = null, assignedBy: "bot" | "user" = "bot") =>
    db().insert(schema.entryCategories).values({ entryId, categoryId, receiptId, assignedBy });
  const namesOf = async (entryId: string) => {
    const page = await listEntries(db(), u.owner, pile);
    return page.ok ? page.value.entries.find((e) => e.id === entryId)?.categories.map((c) => c.name) : null;
  };

  beforeAll(async () => {
    testDb = await createTestDatabase(process.env.DATABASE_URL!);
    await db().insert(schema.users).values(Object.entries(u).map(([name, id]) => ({ id, name, email: `${name}-${id}@example.com` })));
    await db().insert(schema.projects).values({ id: other, name: "Other", ownerId: u.outsider });
    await db().insert(schema.memberships).values({ projectId: other, userId: u.outsider, role: "owner" });
    otherCategory = await category("Secrets", "user", other);
  });

  beforeEach(async () => {
    pile = randomUUID();
    await db().insert(schema.projects).values({ id: pile, name: "Trip", ownerId: u.owner });
    await db()
      .insert(schema.memberships)
      .values([
        { projectId: pile, userId: u.owner, role: "owner" },
        { projectId: pile, userId: u.editor, role: "editor" },
        { projectId: pile, userId: u.viewer, role: "viewer" },
      ]);
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  it("lists chips with live counts, and stamps entries in chip order", async () => {
    const stays = await category("Stays");
    const food = await category("Food");
    const a = await note("Gracery");
    const b = await note("Ramen");
    const gone = await note("Old", { deletedAt: new Date() });
    await file(a, stays);
    await file(a, food);
    await file(b, food);
    await file(gone, food);
    expect(await listCategories(db(), pile)).toEqual([
      { id: stays, name: "Stays", count: 1 },
      { id: food, name: "Food", count: 2 },
    ]);
    expect(await namesOf(a)).toEqual(["Stays", "Food"]);
    const page = await listEntries(db(), u.viewer, pile);
    expect(page.ok && page.value.categories.map((c) => c.name)).toEqual(["Stays", "Food"]);
  });

  it("filters the feed to a category's posts and their replies, in the pile only", async () => {
    const food = await category("Food");
    const ramen = await note("Ramen");
    const reply = await note("Yes please", { replyToId: ramen });
    await note("Train times");
    await file(ramen, food);
    const page = await listEntries(db(), u.viewer, pile, { category: food });
    expect(page.ok && page.value.entries.map((e) => e.id)).toEqual([ramen, reply]);
    // Another pile's category shows nothing here.
    const foreign = await listEntries(db(), u.viewer, pile, { category: otherCategory });
    expect(foreign.ok && foreign.value.entries).toEqual([]);
    expect((await listEntries(db(), u.viewer, pile, { category: "nope" })).ok).toBe(false);
  });

  it("lets owners and editors pick an entry's categories, and marks it sorted so the bot leaves it", async () => {
    const stays = await category("Stays");
    const food = await category("Food");
    const entry = await note("Ryokan with dinner");
    const res = await setEntryCategories(db(), u.editor, entry, { categoryIds: [stays, food] });
    expect(res.ok && res.value.categories.map((c) => c.name)).toEqual(["Stays", "Food"]);
    const rows = await db().select().from(schema.entryCategories).where(eq(schema.entryCategories.entryId, entry));
    expect(rows.every((r) => r.assignedBy === "user")).toBe(true);
    const [row] = await db().select().from(schema.entries).where(eq(schema.entries.id, entry));
    expect(row!.sortedAt).not.toBeNull();

    expect((await setEntryCategories(db(), u.owner, entry, { categoryIds: [food] })).ok).toBe(true);
    expect(await namesOf(entry)).toEqual(["Food"]);

    expect(await setEntryCategories(db(), u.viewer, entry, { categoryIds: [] })).toMatchObject({ ok: false, status: 403 });
    expect(await setEntryCategories(db(), u.outsider, entry, { categoryIds: [] })).toMatchObject({ ok: false, status: 404 });
    expect(await setEntryCategories(db(), u.editor, entry, { categoryIds: [otherCategory] })).toMatchObject({ ok: false, status: 404 });
    const reply = await note("Agreed", { replyToId: entry });
    expect(await setEntryCategories(db(), u.editor, reply, { categoryIds: [food] })).toMatchObject({ ok: false, status: 400 });
    await db().update(schema.projects).set({ archivedAt: new Date() }).where(eq(schema.projects.id, pile));
    expect(await setEntryCategories(db(), u.editor, entry, { categoryIds: [] })).toMatchObject({ ok: false, status: 403 });
  });

  it("adds, renames, merges, and removes categories", async () => {
    const created = await createCategory(db(), u.editor, pile, { name: " Onsen " });
    expect(created.ok && created.value.name).toBe("Onsen");
    expect(await createCategory(db(), u.editor, pile, { name: "onsen" })).toMatchObject({ ok: false, status: 409 });
    expect(await createCategory(db(), u.viewer, pile, { name: "Food" })).toMatchObject({ ok: false, status: 403 });
    expect(await createCategory(db(), u.outsider, pile, { name: "Food" })).toMatchObject({ ok: false, status: 404 });
    const onsen = created.ok ? created.value.id : "";

    expect((await updateCategory(db(), u.owner, onsen, { name: "Hot springs" })).ok).toBe(true);
    expect(await updateCategory(db(), u.outsider, onsen, { name: "Mine" })).toMatchObject({ ok: false, status: 404 });

    const stays = await category("Stays");
    const a = await note("Hakone ryokan");
    const b = await note("Kurama");
    await file(a, stays);
    await file(a, onsen);
    await file(b, onsen);
    const merged = await updateCategory(db(), u.editor, onsen, { mergeInto: stays });
    expect(merged.ok && merged.value.name).toBe("Stays");
    expect(await namesOf(a)).toEqual(["Stays"]);
    expect(await namesOf(b)).toEqual(["Stays"]);
    expect(await updateCategory(db(), u.editor, stays, { mergeInto: otherCategory })).toMatchObject({ ok: false, status: 404 });

    expect((await deleteCategory(db(), u.editor, stays)).ok).toBe(true);
    expect(await namesOf(a)).toEqual([]);
    expect(await listCategories(db(), pile)).toEqual([]);
    expect(await deleteCategory(db(), u.editor, otherCategory)).toMatchObject({ ok: false, status: 404 });
  });

  it(`stops at ${MAX_CATEGORIES} categories`, async () => {
    for (let i = 0; i < MAX_CATEGORIES; i++) await category(`C${i}`, "user");
    expect(await createCategory(db(), u.editor, pile, { name: "One more" })).toMatchObject({ ok: false, status: 409 });
  });

  it("shows what a receipt lists, and Undo takes back only that burst", async () => {
    const [first] = await db().insert(schema.entries).values({ projectId: pile, kind: "bot", botCard: "sorted-first" }).returning();
    const stays = await category("Stays");
    const [receipt] = await db().insert(schema.entries).values({ projectId: pile, kind: "bot", botCard: "sorted" }).returning();
    const sights = await category("Sights");
    const a = await note("Gracery");
    const b = await note("Kiyomizu");
    const c = await note("Fushimi");
    await file(a, stays, first!.id);
    await file(b, sights, receipt!.id);
    await file(c, sights, receipt!.id);
    await file(c, stays, null, "user");

    const page = await listEntries(db(), u.owner, pile);
    const card = page.ok ? page.value.entries.find((e) => e.id === receipt!.id) : null;
    expect(card?.receipt).toEqual({ count: 2, categories: ["Sights"] });

    expect(await undoReceipt(db(), u.viewer, receipt!.id)).toMatchObject({ ok: false, status: 403 });
    expect(await undoReceipt(db(), u.editor, first!.id)).toMatchObject({ ok: false, status: 404 });
    expect((await undoReceipt(db(), u.editor, receipt!.id)).ok).toBe(true);
    expect(await namesOf(b)).toEqual([]);
    expect(await namesOf(c)).toEqual(["Stays"]);
    expect(await namesOf(a)).toEqual(["Stays"]);
    // "Sights" was made in that burst and is empty now, so it goes; "Stays" stays.
    expect((await listCategories(db(), pile)).map((x) => x.name)).toEqual(["Stays"]);
    const [gone] = await db().select().from(schema.entries).where(eq(schema.entries.id, receipt!.id));
    expect(gone!.deletedAt).not.toBeNull();
  });

  it("sends changes live: filing, renaming, and the receipt all show up in the next pull", async () => {
    const food = await category("Food");
    const [receipt] = await db().insert(schema.entries).values({ projectId: pile, kind: "bot", botCard: "sorted" }).returning();
    const ramen = await note("Ramen");
    const long = new Date(Date.now() - 60_000).toISOString();
    await db().update(schema.entries).set({ updatedAt: new Date(long) }).where(eq(schema.entries.projectId, pile));
    const before = await listChanges(db(), u.viewer, pile, new Date().toISOString());
    expect(before.ok && before.value.entries).toEqual([]);

    await file(ramen, food, receipt!.id);
    const changes = await listChanges(db(), u.viewer, pile, new Date(Date.now() - 1000).toISOString());
    expect(changes.ok && changes.value.entries.map((e) => e.id).sort()).toEqual([ramen, receipt!.id].sort());

    await db().update(schema.entries).set({ updatedAt: new Date(long) }).where(eq(schema.entries.projectId, pile));
    await updateCategory(db(), u.editor, food, { name: "Eats" });
    const renamed = await listChanges(db(), u.viewer, pile, new Date(Date.now() - 1000).toISOString());
    expect(renamed.ok && renamed.value.entries.find((e) => e.id === ramen)?.categories).toEqual([{ id: food, name: "Eats" }]);
    expect(renamed.ok && renamed.value.categories).toEqual([{ id: food, name: "Eats", count: 1 }]);
  });

  it("queues sorting after a post, but not after a reply or a link", async () => {
    const sent: { name: string; options?: SendOptions }[] = [];
    const queue: JobQueue = { send: async (name, _payload, options) => void sent.push({ name, options }) };
    const res = await createEntry(db(), u.editor, pile, { text: "Ramen at Fuunji" }, queue);
    expect(sent).toEqual([{ name: "bot.sort", options: expect.objectContaining({ singletonKey: pile }) }]);
    sent.length = 0;
    await createEntry(db(), u.editor, pile, { text: "Yes!", replyToId: res.ok ? res.value.id : "" }, queue);
    await createEntry(db(), u.editor, pile, { text: "https://example.com/hotel" }, queue);
    expect(sent.map((s) => s.name)).toEqual(["link.unfurl"]);
    expect(await db().select().from(schema.entries).where(and(eq(schema.entries.projectId, pile)))).toHaveLength(3);
  });
});
