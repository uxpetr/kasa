import { randomUUID } from "node:crypto";
import { eq, schema } from "@kasa/db";
import { createTestDatabase, type TestDatabase } from "@kasa/db/testing";
import type { JobQueue } from "@kasa/jobs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createEntry, listEntries } from "./entries";
import { accountLinkUrl, accountTelegram, groupLinkUrl, pileTelegram, queueTelegram, telegramBot, unlinkAccount, unlinkPile, webhookAuthorized } from "./telegram";

describe("the webhook secret (P-18)", () => {
  it("accepts only the exact secret, and nothing when none is set", () => {
    expect(webhookAuthorized("s3cret-value", "s3cret-value")).toBe(true);
    expect(webhookAuthorized("s3cret-valuf", "s3cret-value")).toBe(false);
    expect(webhookAuthorized("s3cret", "s3cret-value")).toBe(false);
    expect(webhookAuthorized(null, "s3cret-value")).toBe(false);
    expect(webhookAuthorized("anything", undefined)).toBe(false);
    expect(webhookAuthorized("", "")).toBe(false);
  });

  it("is off without a token and a username", () => {
    expect(telegramBot({})).toBeNull();
    expect(telegramBot({ TELEGRAM_BOT_TOKEN: "t" })).toBeNull();
    expect(telegramBot({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_BOT_USERNAME: "@kasa_piles_bot" })).toBe("kasa_piles_bot");
  });
});

describe.skipIf(!process.env.DATABASE_URL)("Telegram linking in the app (P-18)", () => {
  let testDb: TestDatabase;
  const db = () => testDb.db;
  const u = { owner: randomUUID(), editor: randomUUID(), outsider: randomUUID() };
  let pile: string;
  const sent: { name: string; payload: unknown }[] = [];
  const queue: JobQueue = { send: async (name, payload) => void sent.push({ name, payload }) };
  const saved = { token: process.env.TELEGRAM_BOT_TOKEN, username: process.env.TELEGRAM_BOT_USERNAME };

  beforeAll(async () => {
    testDb = await createTestDatabase(process.env.DATABASE_URL!);
    await db().insert(schema.users).values(Object.entries(u).map(([name, id]) => ({ id, name, email: `${name}-${id}@example.com` })));
  });
  beforeEach(async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_BOT_USERNAME = "kasa_piles_bot";
    sent.length = 0;
    pile = randomUUID();
    await db().insert(schema.projects).values({ id: pile, name: "Kyoto", ownerId: u.owner });
    await db().insert(schema.memberships).values([
      { projectId: pile, userId: u.owner, role: "owner" },
      { projectId: pile, userId: u.editor, role: "editor" },
    ]);
  });
  afterEach(() => {
    // Assigning undefined would store the string "undefined".
    for (const [key, value] of [["TELEGRAM_BOT_TOKEN", saved.token], ["TELEGRAM_BOT_USERNAME", saved.username]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  afterAll(async () => {
    await testDb?.drop();
  });

  it("gives the owner a one-time group link, and nobody else", async () => {
    const link = await groupLinkUrl(db(), u.owner, pile);
    if (!link.ok) throw new Error(link.error);
    const code = /^https:\/\/t\.me\/kasa_piles_bot\?startgroup=([A-Za-z0-9_-]{20,})$/.exec(link.value.url)?.[1];
    const [row] = await db().select().from(schema.telegramCodes).where(eq(schema.telegramCodes.code, code!));
    expect(row).toMatchObject({ kind: "group", userId: u.owner, projectId: pile, usedAt: null });
    expect(await groupLinkUrl(db(), u.editor, pile)).toMatchObject({ ok: false, status: 403 });
    expect(await groupLinkUrl(db(), u.outsider, pile)).toMatchObject({ ok: false, status: 404 });
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(await groupLinkUrl(db(), u.owner, pile)).toMatchObject({ ok: false, status: 503 });
  });

  it("shows the linked group to members, and lets only the owner unlink it", async () => {
    await db().insert(schema.telegramLinks).values({ projectId: pile, chatId: "-100555", chatTitle: "Kyoto trip", linkedBy: u.owner });
    expect(await pileTelegram(db(), u.editor, pile)).toEqual({ ok: true, value: { available: true, linked: { title: "Kyoto trip" }, canLink: false } });
    expect(await pileTelegram(db(), u.outsider, pile)).toMatchObject({ ok: false, status: 404 });
    expect(await unlinkPile(db(), u.editor, pile)).toMatchObject({ ok: false, status: 403 });
    expect(await unlinkPile(db(), u.owner, pile)).toMatchObject({ ok: true });
    expect(await pileTelegram(db(), u.owner, pile)).toMatchObject({ ok: true, value: { linked: null, canLink: true } });
  });

  it("links and unlinks a person's Telegram account", async () => {
    const link = await accountLinkUrl(db(), u.editor);
    expect(link.ok && link.value.url).toMatch(/^https:\/\/t\.me\/kasa_piles_bot\?start=/);
    await db().insert(schema.telegramIdentities).values({ userId: u.editor, telegramUserId: String(Math.floor(Math.random() * 1e9)) });
    expect(await accountTelegram(db(), u.editor)).toEqual({ available: true, linked: true });
    await unlinkAccount(db(), u.editor);
    expect(await accountTelegram(db(), u.editor)).toEqual({ available: true, linked: false });
  });

  it("queues posts for Telegram only when the pile has a group", async () => {
    const before = await createEntry(db(), u.editor, pile, { text: "Ramen?" }, queue);
    expect(sent.map((s) => s.name)).not.toContain("telegram.send");
    await db().insert(schema.telegramLinks).values({ projectId: pile, chatId: `-100${Date.now()}`, linkedBy: u.owner });
    const after = await createEntry(db(), u.editor, pile, { text: "Gyoza?" }, queue);
    expect(sent.filter((s) => s.name === "telegram.send")).toEqual([{ name: "telegram.send", payload: { entryId: after.ok && after.value.id } }]);
    expect(before.ok).toBe(true);
    await queueTelegram(db(), queue, randomUUID(), randomUUID());
    expect(sent.filter((s) => s.name === "telegram.send")).toHaveLength(1);
  });

  it("shows Telegram posts as via Telegram, and guests by their Telegram name", async () => {
    await db().insert(schema.entries).values([
      { projectId: pile, authorId: null, guestName: "Kenji", kind: "note", body: "Hi all", source: "telegram" },
      { projectId: pile, authorId: u.editor, kind: "note", body: "From the app", createdAt: new Date(Date.now() + 1000) },
    ]);
    const page = await listEntries(db(), u.owner, pile);
    if (!page.ok) throw new Error(page.error);
    expect(page.value.entries.map((e) => [e.body, e.source, e.guest, e.author?.id ?? null])).toEqual([
      ["Hi all", "telegram", "Kenji", null],
      ["From the app", "app", null, u.editor],
    ]);
  });
});
