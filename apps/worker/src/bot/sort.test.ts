import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, schema } from "@kasa/db";
import { createTestDatabase, type TestDatabase } from "@kasa/db/testing";
import { BOT_MAX_CATEGORIES, RECEIPT_BURST_MS, SORT_START_AT } from "@kasa/shared";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { answerBot } from ".";
import { sdkModel, stubModel, type BotModel, type SortDecision, type SortInput } from "./model";
import { cleanName, sortPile } from "./sort";

describe("sorting helpers (P-19)", () => {
  it("cleans category names", () => {
    expect(cleanName("  getting   around ")).toBe("Getting around");
    expect(cleanName("x".repeat(50))).toHaveLength(30);
    expect(cleanName("   ")).toBeNull();
    expect(cleanName(3)).toBeNull();
  });

  it("reads a structured decision through the AI SDK", async () => {
    const decision: SortDecision = { newCategories: ["Stays"], assignments: [{ ref: 1, categories: ["Stays"] }] };
    const mock = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: JSON.stringify(decision) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 40, text: 40, reasoning: 0 } },
        warnings: [],
      }),
    });
    const reply = await sdkModel("anthropic/claude-haiku-4.5", mock).sort({ instructions: "Sort.", prompt: "#1 a hotel", items: [], categories: [] });
    expect(reply).toEqual({ decision, model: "anthropic/claude-haiku-4.5", inputTokens: 900, outputTokens: 40 });
  });
});

describe.skipIf(!process.env.DATABASE_URL)("Kasa Bot sorts piles (P-19)", () => {
  let testDb: TestDatabase;
  const db = () => testDb.db;
  const u = { mika: randomUUID(), stranger: randomUUID() };
  const other = randomUUID();
  const SECRET = "Other pile secret: the surprise party is at Café Kuro";
  let pile: string;

  /** A model that remembers what it was shown and answers with `decide`. */
  function recording(decide: (input: SortInput) => SortDecision) {
    const seen: SortInput[] = [];
    const model: BotModel = {
      id: "anthropic/claude-haiku-4.5",
      answer: stubModel.answer,
      async sort(input) {
        seen.push(input);
        return { decision: decide(input), model: "anthropic/claude-haiku-4.5", inputTokens: 1000, outputTokens: 50 };
      },
    };
    return { model, seen };
  }
  /** Everything into one category, by kind for links. */
  const simple = recording((input) => ({
    newCategories: input.categories.length ? [] : ["Stays", "Food"],
    assignments: input.items.map((i) => ({ ref: i.ref, categories: [i.kind === "link" ? "Stays" : "Food"] })),
  }));

  async function post(body: string, extra: Partial<typeof schema.entries.$inferInsert> = {}) {
    const [row] = await db()
      .insert(schema.entries)
      .values({ projectId: pile, authorId: u.mika, kind: "note", body, ...extra })
      .returning();
    return row!.id;
  }
  const categoriesOf = async (entryId: string) =>
    (
      await db()
        .select({ name: schema.categories.name, assignedBy: schema.entryCategories.assignedBy, receiptId: schema.entryCategories.receiptId })
        .from(schema.entryCategories)
        .innerJoin(schema.categories, eq(schema.categories.id, schema.entryCategories.categoryId))
        .where(eq(schema.entryCategories.entryId, entryId))
        .orderBy(asc(schema.categories.name))
    ).map((r) => r.name);
  const receipts = () =>
    db()
      .select({ id: schema.entries.id, botCard: schema.entries.botCard })
      .from(schema.entries)
      .where(and(eq(schema.entries.projectId, pile), eq(schema.entries.kind, "bot")))
      .orderBy(asc(schema.entries.createdAt));

  beforeAll(async () => {
    testDb = await createTestDatabase(process.env.DATABASE_URL!);
    await db()
      .insert(schema.users)
      .values([
        { id: u.mika, name: "Mika", email: `mika-${u.mika}@example.com` },
        { id: u.stranger, name: "Stranger", email: `s-${u.stranger}@example.com` },
      ]);
    await db().insert(schema.projects).values({ id: other, name: "Secret Birthday", ownerId: u.stranger });
    await db().insert(schema.memberships).values({ projectId: other, userId: u.stranger, role: "owner" });
    await db().insert(schema.entries).values({ projectId: other, authorId: u.stranger, kind: "note", body: SECRET });
    await db().insert(schema.categories).values({ projectId: other, name: "Party secrets", createdBy: "user" });
  });

  beforeEach(async () => {
    pile = randomUUID();
    await db().insert(schema.projects).values({ id: pile, name: "Japan 2027", ownerId: u.mika });
    await db().insert(schema.memberships).values({ projectId: pile, userId: u.mika, role: "owner" });
    simple.seen.length = 0;
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  it(`waits for ${SORT_START_AT} posts, then sets up categories with a receipt that names them`, async () => {
    for (let i = 0; i < SORT_START_AT - 1; i++) await post(`Ramen idea ${i}`);
    expect(await sortPile({ db: db(), model: simple.model }, pile)).toEqual({ sorted: 0, receiptId: null });
    expect(simple.seen).toHaveLength(0);

    const [hotel] = await db().insert(schema.entries).values({ projectId: pile, authorId: u.mika, kind: "link" }).returning();
    await db().insert(schema.linkPreviews).values({ entryId: hotel!.id, url: "https://example.com/gracery", title: "Hotel Gracery" });
    const result = await sortPile({ db: db(), model: simple.model }, pile);
    expect(result.sorted).toBe(SORT_START_AT);
    expect(await categoriesOf(hotel!.id)).toEqual(["Stays"]);
    expect(simple.seen[0]!.prompt).toContain("Hotel Gracery");
    expect(simple.seen[0]!.instructions).toContain("no categories yet");
    expect(await receipts()).toEqual([{ id: result.receiptId, botCard: "sorted-first" }]);
    const cats = await db().select().from(schema.categories).where(eq(schema.categories.projectId, pile));
    expect(cats.map((c) => [c.name, c.createdBy]).sort()).toEqual([
      ["Food", "bot"],
      ["Stays", "bot"],
    ]);
  });

  it("never reads or files into another pile", async () => {
    for (let i = 0; i < SORT_START_AT; i++) await post(`Note ${i}`);
    const sneaky = recording(() => ({ newCategories: [], assignments: [{ ref: 1, categories: ["Party secrets"] }] }));
    await sortPile({ db: db(), model: sneaky.model }, pile);
    const everything = JSON.stringify(sneaky.seen);
    expect(everything).not.toContain("Café Kuro");
    expect(everything).not.toContain("Party secrets");
    // The other pile's category name isn't one of this pile's, so nothing is filed.
    const [linked] = await db().select().from(schema.entryCategories).innerJoin(schema.categories, eq(schema.categories.id, schema.entryCategories.categoryId)).where(eq(schema.categories.projectId, other));
    expect(linked).toBeUndefined();
  });

  it("sorts only people's posts: not replies, bot cards, deleted or already sorted entries", async () => {
    const root = await post("Kyoto plan");
    for (let i = 0; i < SORT_START_AT; i++) await post(`Note ${i}`);
    const reply = await post("Agreed", { replyToId: root });
    const bot = await post("", { kind: "bot", authorId: null, body: "An answer" });
    const gone = await post("Deleted", { deletedAt: new Date() });
    await sortPile({ db: db(), model: simple.model }, pile);
    const kinds = simple.seen.flatMap((s) => s.items.map((i) => i.kind));
    expect(kinds).toHaveLength(SORT_START_AT + 1);
    for (const id of [reply, bot, gone]) expect(await categoriesOf(id)).toEqual([]);

    // A second run finds nothing new and makes no model call.
    await sortPile({ db: db(), model: simple.model }, pile);
    expect(simple.seen).toHaveLength(1);
  });

  it("grows one receipt per burst, and starts a new one after 10 quiet minutes", async () => {
    for (let i = 0; i < SORT_START_AT; i++) await post(`Note ${i}`);
    const t0 = Date.now();
    await sortPile({ db: db(), model: simple.model, now: () => new Date(t0) }, pile);
    await post("More food");
    const second = await sortPile({ db: db(), model: simple.model, now: () => new Date(t0) }, pile);
    await post("Even more food");
    const third = await sortPile({ db: db(), model: simple.model, now: () => new Date(t0 + 60_000) }, pile);
    expect(third.receiptId).toBe(second.receiptId);
    await post("Tomorrow's food");
    const later = await sortPile({ db: db(), model: simple.model, now: () => new Date(Date.now() + RECEIPT_BURST_MS + 1000) }, pile);
    expect(later.receiptId).not.toBe(second.receiptId);
    expect((await receipts()).map((r) => r.botCard)).toEqual(["sorted-first", "sorted", "sorted"]);
  });

  it("keeps members' fixes, shows them as examples, and adds categories only up to the limit", async () => {
    for (let i = 0; i < SORT_START_AT; i++) await post(`Note ${i}`);
    await sortPile({ db: db(), model: simple.model }, pile);
    // Mika files a note under her own category.
    const [mine] = await db().insert(schema.categories).values({ projectId: pile, name: "Onsen", createdBy: "user" }).returning();
    const fixed = await post("Kurama onsen day trip");
    await db().update(schema.entries).set({ sortedAt: new Date() }).where(eq(schema.entries.id, fixed));
    await db().insert(schema.entryCategories).values({ entryId: fixed, categoryId: mine!.id, assignedBy: "user" });

    const greedy = recording(() => ({
      newCategories: Array.from({ length: 10 }, (_, i) => `New ${i}`),
      assignments: [{ ref: 1, categories: Array.from({ length: 10 }, (_, i) => `New ${i}`) }, { ref: 99, categories: ["Food"] }],
    }));
    const next = await post("Hot spring near Hakone");
    await sortPile({ db: db(), model: greedy.model }, pile);
    expect(greedy.seen[0]!.prompt).toContain("Kurama onsen day trip → Onsen");
    // In the order they were made. "Stays" was proposed but nothing went in, so it wasn't made.
    expect(greedy.seen[0]!.categories).toEqual(["Food", "Onsen"]);
    // At most three per entry, and the pile never goes past the bot's limit.
    expect((await categoriesOf(next)).length).toBe(3);
    const count = (await db().select().from(schema.categories).where(eq(schema.categories.projectId, pile))).length;
    expect(count).toBeLessThanOrEqual(BOT_MAX_CATEGORIES);
    expect(await categoriesOf(fixed)).toEqual(["Onsen"]);
  });

  it("stops at the monthly cap, and sorting doesn't use up the daily answer limit", async () => {
    for (let i = 0; i < SORT_START_AT; i++) await post(`Note ${i}`);
    expect((await sortPile({ db: db(), model: simple.model, monthlyCapMicros: 0 }, pile)).sorted).toBe(0);
    expect(await db().select().from(schema.entries).where(and(eq(schema.entries.projectId, pile), isNull(schema.entries.sortedAt)))).toHaveLength(SORT_START_AT);

    await sortPile({ db: db(), model: simple.model }, pile);
    const usage = await db().select().from(schema.botUsage).where(eq(schema.botUsage.projectId, pile));
    expect(usage.map((r) => r.outcome)).toEqual(["sorted"]);
    expect(usage[0]!.costMicros).toBe(1250);

    // With a limit of one answer a day, the sort above doesn't count.
    const question = await post("@kasa where to eat?");
    const [card] = await db().insert(schema.entries).values({ projectId: pile, authorId: null, kind: "bot", replyToId: question, botCard: "pending" }).returning();
    await answerBot({ db: db(), model: stubModel, dailyLimit: 1 }, card!.id);
    const [answered] = await db().select().from(schema.entries).where(eq(schema.entries.id, card!.id));
    expect(answered!.botCard).toBeNull();
  });

  it("doesn't charge the pile when saving the sort fails, so a retry is billed once", async () => {
    for (let i = 0; i < SORT_START_AT; i++) await post(`Note ${i}`);
    const base = db();
    const transaction = base.transaction.bind(base);
    const failing = new Proxy(base, {
      get(target, prop, receiver) {
        if (prop === "transaction") {
          const wrapped: typeof base.transaction = (run, config) =>
            transaction(async (tx) => {
              await run(tx);
              throw new Error("apply failed");
            }, config);
          return wrapped;
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await expect(sortPile({ db: failing, model: simple.model }, pile)).rejects.toThrow("apply failed");
    expect(await base.select().from(schema.botUsage).where(eq(schema.botUsage.projectId, pile))).toHaveLength(0);
    expect(
      await base.select().from(schema.entries).where(and(eq(schema.entries.projectId, pile), isNull(schema.entries.sortedAt), eq(schema.entries.kind, "note"))),
    ).toHaveLength(SORT_START_AT);

    await sortPile({ db: base, model: simple.model }, pile);
    const usage = await base.select().from(schema.botUsage).where(eq(schema.botUsage.projectId, pile));
    expect(usage.map((r) => r.outcome)).toEqual(["sorted"]);
  });

  it("does nothing when the pile has Kasa Bot off or there's no model", async () => {
    for (let i = 0; i < SORT_START_AT; i++) await post(`Note ${i}`);
    expect((await sortPile({ db: db(), model: null }, pile)).sorted).toBe(0);
    await db().update(schema.projects).set({ botMode: "off" }).where(eq(schema.projects.id, pile));
    expect((await sortPile({ db: db(), model: simple.model }, pile)).sorted).toBe(0);
    expect(simple.seen).toHaveLength(0);
  });

  it("sorts with the stub model, one category per kind", async () => {
    for (let i = 0; i < SORT_START_AT; i++) await post(`Note ${i}`);
    const photo = await post("Fuji at sunset", { kind: "photo" });
    await sortPile({ db: db(), model: stubModel }, pile);
    expect(await categoriesOf(photo)).toEqual(["Photos"]);
  });
});
