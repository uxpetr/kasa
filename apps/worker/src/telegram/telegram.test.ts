import { randomUUID } from "node:crypto";
import { and, eq, schema } from "@kasa/db";
import { createTestDatabase, type TestDatabase } from "@kasa/db/testing";
import type { JobName, JobQueue } from "@kasa/jobs";
import type { Storage } from "@kasa/media";
import { setAnalyticsSink, type TrackedEvent } from "@kasa/shared";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TelegramError, type TelegramApi, type TgMessage, type TgUpdate } from "./api";
import { formatEntry, startCode } from "./format";
import { handleUpdate, SAY, type TelegramDeps } from "./inbound";
import { sendEntry } from "./outbound";

describe("Telegram formats (D-207)", () => {
  it("puts the author's name first, and lists Kasa Bot's ideas as links", () => {
    expect(formatEntry({ kind: "note", author: "Mika", body: "Ramen?", url: null, ideas: [] })).toBe("Mika: Ramen?");
    expect(formatEntry({ kind: "link", author: "Mika", body: null, url: "https://example.com/a", ideas: [] })).toBe("Mika: https://example.com/a");
    expect(formatEntry({ kind: "photo", author: "Mika", body: null, url: null, ideas: [] })).toBe("Mika");
    expect(formatEntry({ kind: "photo", author: "Mika", body: "Gion at night", url: null, ideas: [] })).toBe("Mika: Gion at night");
    expect(formatEntry({ kind: "bot", author: "Kasa Bot", body: "Two spots:", url: null, ideas: [{ title: "Inoichi", url: "https://example.com/i" }] })).toBe(
      "Kasa Bot: Two spots:\n\n• Inoichi: https://example.com/i",
    );
  });

  it("reads /start codes, also addressed to this bot, and nothing else", () => {
    expect(startCode("/start abcdefgh1234", "kasa_piles_bot")).toBe("abcdefgh1234");
    expect(startCode("/start@kasa_piles_bot abcdefgh1234", "kasa_piles_bot")).toBe("abcdefgh1234");
    expect(startCode("/start@other_bot abcdefgh1234", "kasa_piles_bot")).toBeNull();
    expect(startCode("/start", "kasa_piles_bot")).toBeNull();
    expect(startCode("hello /start abcdefgh1234", "kasa_piles_bot")).toBeNull();
  });
});

/** Telegram as the tests see it: what the bot sent, and files it can download. */
function fakeTelegram() {
  let nextId = 1000;
  const sent: { method: string; chatId: string; text?: string; replyTo?: number; photos?: number }[] = [];
  const files = new Map<string, Buffer>();
  let refuse: TelegramError | null = null;
  const message = (chatId: string): TgMessage => ({ message_id: ++nextId, chat: { id: Number(chatId), type: "group" }, date: 0 });
  const api: TelegramApi = {
    getMe: async () => ({ id: 1, is_bot: true, first_name: "Kasa", username: "kasa_piles_bot" }),
    async sendMessage(chatId, text, opts) {
      if (refuse) throw refuse;
      sent.push({ method: "sendMessage", chatId, text, replyTo: opts?.replyTo });
      return message(chatId);
    },
    async sendPhoto(chatId, _photo, caption, opts) {
      if (refuse) throw refuse;
      sent.push({ method: "sendPhoto", chatId, text: caption, replyTo: opts?.replyTo, photos: 1 });
      return message(chatId);
    },
    async sendMediaGroup(chatId, photos, caption, opts) {
      if (refuse) throw refuse;
      sent.push({ method: "sendMediaGroup", chatId, text: caption, replyTo: opts?.replyTo, photos: photos.length });
      return photos.map(() => message(chatId));
    },
    async downloadFile(fileId) {
      const body = files.get(fileId);
      if (!body) throw new TelegramError(400, "file not found");
      return { body, path: `photos/${fileId}.jpg` };
    },
    getUpdates: async () => [],
    setWebhook: async () => {},
  };
  return { api, sent, files, refuseWith: (e: TelegramError | null) => (refuse = e) };
}

function memoryStorage(): Storage {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  return {
    async head(key: string) {
      const o = objects.get(key);
      return o ? { size: o.body.length, contentType: o.contentType } : null;
    },
    async read(key: string) {
      const o = objects.get(key);
      if (!o) throw new Error(`no object ${key}`);
      return o.body;
    },
    async write(key: string, body: Buffer, contentType: string) {
      objects.set(key, { body, contentType });
    },
    async remove(key: string) {
      objects.delete(key);
    },
  } as unknown as Storage;
}

describe.skipIf(!process.env.DATABASE_URL)("Telegram sync (P-18)", () => {
  let testDb: TestDatabase;
  const db = () => testDb.db;
  const u = { owner: randomUUID(), editor: randomUUID(), viewer: randomUUID(), outsider: randomUUID() };
  const tg = { owner: 501, editor: 502, viewer: 503, outsider: 504, guest: 599 };
  let pile: string;
  let other: string;
  let chat: string;
  let otherChat: string;
  let telegram: ReturnType<typeof fakeTelegram>;
  let deps: TelegramDeps;
  const jobs: { name: JobName; payload: unknown }[] = [];
  const queue: JobQueue = { send: async (name, payload) => void jobs.push({ name, payload }) };
  const events: TrackedEvent[] = [];
  let restoreSink: () => void;
  let messageId = 1;

  const from = (id: number, first = "Kenji") => ({ id, is_bot: false, first_name: first });
  const groupMessage = (chatId: string, sender: number, extra: Partial<TgMessage> = {}): TgUpdate => ({
    update_id: messageId,
    message: { message_id: messageId++, from: from(sender), chat: { id: Number(chatId), type: "supergroup", title: "Kyoto trip" }, date: 0, ...extra },
  });
  const entriesIn = (projectId: string) => db().select().from(schema.entries).where(eq(schema.entries.projectId, projectId)).orderBy(schema.entries.createdAt);
  async function code(kind: "group" | "account", userId: string, projectId?: string, expiresAt = new Date(Date.now() + 60_000)) {
    const value = randomUUID().replace(/-/g, "");
    await db().insert(schema.telegramCodes).values({ code: value, kind, userId, projectId, expiresAt });
    return value;
  }

  beforeAll(async () => {
    testDb = await createTestDatabase(process.env.DATABASE_URL!);
    await db().insert(schema.users).values(Object.entries(u).map(([name, id]) => ({ id, name: name[0]!.toUpperCase() + name.slice(1), email: `${name}-${id}@example.com` })));
    await db().insert(schema.telegramIdentities).values([
      { userId: u.owner, telegramUserId: String(tg.owner) },
      { userId: u.editor, telegramUserId: String(tg.editor) },
      { userId: u.viewer, telegramUserId: String(tg.viewer) },
      { userId: u.outsider, telegramUserId: String(tg.outsider) },
    ]);
    restoreSink = setAnalyticsSink((e) => void events.push(e));
  });

  beforeEach(async () => {
    jobs.length = 0;
    events.length = 0;
    telegram = fakeTelegram();
    deps = { db: db(), api: telegram.api, storage: memoryStorage(), queue, botUsername: "kasa_piles_bot" };
    pile = randomUUID();
    other = randomUUID();
    chat = String(-1000000000000 - Math.floor(Math.random() * 1e9));
    otherChat = String(-2000000000000 - Math.floor(Math.random() * 1e9));
    await db().insert(schema.projects).values([
      { id: pile, name: "Kyoto", ownerId: u.owner },
      { id: other, name: "Secret party", ownerId: u.outsider },
    ]);
    await db().insert(schema.memberships).values([
      { projectId: pile, userId: u.owner, role: "owner" },
      { projectId: pile, userId: u.editor, role: "editor" },
      { projectId: pile, userId: u.viewer, role: "viewer" },
      { projectId: other, userId: u.outsider, role: "owner" },
    ]);
  });

  afterAll(async () => {
    restoreSink?.();
    await testDb?.drop();
  });

  async function linkPile(projectId = pile, chatId = chat) {
    await db().insert(schema.telegramLinks).values({ projectId, chatId, chatTitle: "Kyoto trip", linkedBy: u.owner });
  }

  describe("linking", () => {
    it("links a group with the owner's code, once, and says so in the group", async () => {
      const c = await code("group", u.owner, pile);
      await handleUpdate(deps, groupMessage(chat, tg.owner, { text: `/start@kasa_piles_bot ${c}` }));
      const [link] = await db().select().from(schema.telegramLinks).where(eq(schema.telegramLinks.projectId, pile));
      expect(link).toMatchObject({ chatId: chat, chatTitle: "Kyoto trip", linkedBy: u.owner });
      expect(telegram.sent).toEqual([{ method: "sendMessage", chatId: chat, text: SAY.groupLinked("Kyoto"), replyTo: undefined }]);
      expect(events.map((e) => e.event)).toEqual(["telegram_linked"]);

      // Used once: the same code in another group does nothing.
      await handleUpdate(deps, groupMessage(otherChat, tg.owner, { text: `/start ${c}` }));
      expect(telegram.sent.at(-1)?.text).toBe(SAY.codeExpired);
      expect(await db().select().from(schema.telegramLinks).where(eq(schema.telegramLinks.chatId, otherChat))).toEqual([]);
    });

    it("refuses expired codes, codes from someone who's no longer the owner, and groups linked elsewhere", async () => {
      const expired = await code("group", u.owner, pile, new Date(Date.now() - 1000));
      await handleUpdate(deps, groupMessage(chat, tg.owner, { text: `/start ${expired}` }));
      const notOwner = await code("group", u.editor, pile);
      await handleUpdate(deps, groupMessage(chat, tg.editor, { text: `/start ${notOwner}` }));
      expect(telegram.sent.map((s) => s.text)).toEqual([SAY.codeExpired, SAY.codeExpired]);

      await linkPile(other, otherChat);
      const taken = await code("group", u.owner, pile);
      await handleUpdate(deps, groupMessage(otherChat, tg.owner, { text: `/start ${taken}` }));
      expect(telegram.sent.at(-1)?.text).toBe(SAY.groupTaken);
      expect(await db().select().from(schema.telegramLinks).where(eq(schema.telegramLinks.projectId, pile))).toEqual([]);
    });

    it("links a Telegram account in a private chat, replacing any earlier link", async () => {
      const newcomer = randomUUID();
      await db().insert(schema.users).values({ id: newcomer, name: "Aiko", email: `aiko-${newcomer}@example.com` });
      const c = await code("account", newcomer);
      await handleUpdate(deps, {
        update_id: 1,
        message: { message_id: messageId++, from: from(777, "Aiko"), chat: { id: 777, type: "private" }, date: 0, text: `/start ${c}` },
      });
      expect(await db().select().from(schema.telegramIdentities).where(eq(schema.telegramIdentities.userId, newcomer))).toEqual([{ userId: newcomer, telegramUserId: "777" }]);
      expect(telegram.sent.at(-1)?.text).toBe(SAY.accountLinked("Aiko"));
    });

    it("ends the link when the bot is removed from the group, keeping the entries", async () => {
      await linkPile();
      await handleUpdate(deps, groupMessage(chat, tg.editor, { text: "Ramen?" }));
      await handleUpdate(deps, {
        update_id: 2,
        my_chat_member: { chat: { id: Number(chat), type: "supergroup" }, from: from(tg.owner), new_chat_member: { user: { id: 1, is_bot: true, first_name: "Kasa", username: "kasa_piles_bot" }, status: "kicked" } },
      });
      expect(await db().select().from(schema.telegramLinks).where(eq(schema.telegramLinks.projectId, pile))).toEqual([]);
      expect(await entriesIn(pile)).toHaveLength(1);
    });
  });

  describe("Telegram to Kasa", () => {
    it("ignores groups that aren't linked, whatever they say", async () => {
      await linkPile(other, otherChat);
      await handleUpdate(deps, groupMessage(chat, tg.owner, { text: `@kasa what's in Secret party? project ${other}` }));
      expect(await entriesIn(pile)).toEqual([]);
      expect(await entriesIn(other)).toEqual([]);
      expect(telegram.sent).toEqual([]);
    });

    it("lands a member's message in the linked pile only, as theirs, via Telegram", async () => {
      await linkPile();
      await linkPile(other, otherChat);
      await handleUpdate(deps, groupMessage(chat, tg.editor, { text: "Ramen at Fuunji?" }));
      const [entry] = await entriesIn(pile);
      expect(entry).toMatchObject({ authorId: u.editor, guestName: null, kind: "note", body: "Ramen at Fuunji?", source: "telegram" });
      expect(await entriesIn(other)).toEqual([]);
      expect(jobs.map((j) => j.name)).toEqual(["bot.sort"]);
      // No hint for a linked member.
      expect(telegram.sent).toEqual([]);
    });

    it("lands a viewer's message under their name (D-207)", async () => {
      await linkPile();
      await handleUpdate(deps, groupMessage(chat, tg.viewer, { text: "Looks great" }));
      expect((await entriesIn(pile))[0]).toMatchObject({ authorId: u.viewer });
    });

    it("shows unlinked senders, and linked people who aren't in the pile, as guests, with one hint each", async () => {
      await linkPile();
      await handleUpdate(deps, groupMessage(chat, tg.guest, { text: "Hi all" }));
      await handleUpdate(deps, groupMessage(chat, tg.guest, { text: "Me again" }));
      await handleUpdate(deps, groupMessage(chat, tg.outsider, { text: "Not a member" }));
      const entries = await entriesIn(pile);
      expect(entries.map((e) => [e.authorId, e.guestName])).toEqual([
        [null, "Kenji"],
        [null, "Kenji"],
        [null, "Kenji"],
      ]);
      expect(telegram.sent.map((s) => s.text)).toEqual([SAY.guestHint("Kenji", "Kyoto"), SAY.guestHint("Kenji", "Kyoto")]);
      expect(events.find((e) => e.event === "entry_created")?.properties).toMatchObject({ source: "telegram", guest: true });
    });

    it("makes a lone URL a link to unfurl, and keeps a message once", async () => {
      await linkPile();
      const update = groupMessage(chat, tg.editor, { text: "https://example.com/gracery" });
      await handleUpdate(deps, update);
      await handleUpdate(deps, update);
      const entries = await entriesIn(pile);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ kind: "link", body: null });
      const [preview] = await db().select().from(schema.linkPreviews).where(eq(schema.linkPreviews.entryId, entries[0]!.id));
      expect(preview?.url).toBe("https://example.com/gracery");
      expect(jobs).toEqual([{ name: "link.unfurl", payload: { entryId: entries[0]!.id } }]);
    });

    it("maps replies to the entry they answer, and edits to its text", async () => {
      await linkPile();
      const original = groupMessage(chat, tg.editor, { text: "Ramen?" });
      await handleUpdate(deps, original);
      await handleUpdate(deps, groupMessage(chat, tg.owner, { text: "Yes!", reply_to_message: original.message }));
      const [first, reply] = await entriesIn(pile);
      expect(reply).toMatchObject({ replyToId: first!.id, authorId: u.owner });
      await handleUpdate(deps, { update_id: 9, edited_message: { ...original.message!, text: "Ramen at Fuunji?" } });
      expect((await entriesIn(pile))[0]!.body).toBe("Ramen at Fuunji?");
    });

    it("turns photos into photo entries, and an album into one", async () => {
      await linkPile();
      const jpeg = await sharp({ create: { width: 200, height: 120, channels: 3, background: "#2e5b4f" } }).jpeg().toBuffer();
      telegram.files.set("a", jpeg);
      telegram.files.set("b", jpeg);
      telegram.files.set("c", jpeg);
      const photo = (fileId: string) => [
        { file_id: `${fileId}-small`, width: 90, height: 54 },
        { file_id: fileId, width: 200, height: 120 },
      ];
      await handleUpdate(deps, groupMessage(chat, tg.editor, { photo: photo("a"), caption: "Gion" }));
      await handleUpdate(deps, groupMessage(chat, tg.editor, { photo: photo("b"), media_group_id: "album1", caption: "Two views" }));
      await handleUpdate(deps, groupMessage(chat, tg.editor, { photo: photo("c"), media_group_id: "album1" }));
      const entries = await entriesIn(pile);
      expect(entries.map((e) => [e.kind, e.body])).toEqual([
        ["photo", "Gion"],
        ["photo", "Two views"],
      ]);
      const media = await db().select().from(schema.entryMedia).where(eq(schema.entryMedia.entryId, entries[1]!.id));
      expect(media.map((m) => m.position).sort()).toEqual([0, 1]);
      const uploads = await db().select().from(schema.uploads).where(eq(schema.uploads.projectId, pile));
      expect(uploads.every((x) => x.status === "ready" && x.uploaderId === u.editor)).toBe(true);
    });

    it("asks Kasa Bot for @kasa, from anyone in the group, unless the pile turned it off", async () => {
      await linkPile();
      await handleUpdate(deps, groupMessage(chat, tg.guest, { text: "@kasa which hotel is closest?" }));
      const [question, card] = await entriesIn(pile);
      expect(card).toMatchObject({ kind: "bot", botCard: "pending", replyToId: question!.id });
      expect(jobs.map((j) => j.name)).toContain("bot.answer");
      await db().update(schema.projects).set({ botMode: "off" }).where(eq(schema.projects.id, pile));
      jobs.length = 0;
      await handleUpdate(deps, groupMessage(chat, tg.editor, { text: "@kasa_piles_bot hello?" }));
      expect(jobs.map((j) => j.name)).not.toContain("bot.answer");
    });
  });

  describe("Kasa to Telegram", () => {
    async function post(values: Partial<typeof schema.entries.$inferInsert> = {}) {
      const [row] = await db().insert(schema.entries).values({ projectId: pile, authorId: u.editor, kind: "note", body: "Ramen?", ...values }).returning();
      return row!.id;
    }

    it("posts once, with the author's name, as a reply when the original is in the group", async () => {
      await linkPile();
      const original = await post();
      await sendEntry(deps, original);
      await sendEntry(deps, original);
      const reply = await post({ body: "Yes!", authorId: u.owner, replyToId: original });
      await sendEntry(deps, reply);
      expect(telegram.sent).toEqual([
        { method: "sendMessage", chatId: chat, text: "Editor: Ramen?", replyTo: undefined },
        { method: "sendMessage", chatId: chat, text: "Owner: Yes!", replyTo: expect.any(Number) },
      ]);
      const [mapped] = await db().select().from(schema.telegramMessages).where(eq(schema.telegramMessages.entryId, original));
      expect(telegram.sent[1]!.replyTo).toBe(Number(mapped!.messageId));
    });

    it("never sends back what came from Telegram, or to a group that isn't this pile's", async () => {
      await linkPile(other, otherChat);
      await sendEntry(deps, await post());
      await linkPile();
      await sendEntry(deps, await post({ source: "telegram" }));
      expect(telegram.sent).toEqual([]);
    });

    it("sends Kasa Bot's answers with their ideas, not receipts, welcome cards, or unfinished cards", async () => {
      await linkPile();
      const question = await post({ body: "@kasa suggest ramen" });
      const answer = await post({ kind: "bot", authorId: null, replyToId: question, body: "Try these:" });
      await db().insert(schema.botIdeas).values({ entryId: answer, position: 0, url: "https://example.com/i", title: "Inoichi" });
      for (const botCard of ["sorted", "welcome", "pending", "failed"]) await sendEntry(deps, await post({ kind: "bot", authorId: null, botCard, replyToId: question }));
      await sendEntry(deps, answer);
      expect(telegram.sent.map((s) => s.text)).toEqual(["Kasa Bot: Try these:\n\n• Inoichi: https://example.com/i"]);
    });

    it("sends photos as photos, and an album as one", async () => {
      await linkPile();
      const jpeg = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#fff" } }).jpeg().toBuffer();
      const entry = await post({ kind: "photo", body: "Gion" });
      for (const position of [0, 1]) {
        const [upload] = await db().insert(schema.uploads).values({ projectId: pile, contentType: "image/jpeg", size: jpeg.length, status: "ready", fullKey: `k${position}` }).returning();
        await deps.storage.write(`k${position}`, jpeg, "image/jpeg");
        await db().insert(schema.entryMedia).values({ entryId: entry, uploadId: upload!.id, storageKey: `k${position}`, role: "photo", position });
      }
      await sendEntry(deps, entry);
      expect(telegram.sent).toEqual([{ method: "sendMediaGroup", chatId: chat, text: "Editor: Gion", replyTo: undefined, photos: 2 }]);
      expect(await db().select().from(schema.telegramMessages).where(and(eq(schema.telegramMessages.entryId, entry), eq(schema.telegramMessages.direction, "out")))).toHaveLength(2);
    });

    it("ends the link when Telegram says the bot is out of the group", async () => {
      await linkPile();
      telegram.refuseWith(new TelegramError(403, "Forbidden: bot was kicked from the supergroup chat"));
      await sendEntry(deps, await post());
      expect(await db().select().from(schema.telegramLinks).where(eq(schema.telegramLinks.projectId, pile))).toEqual([]);
      telegram.refuseWith(new TelegramError(429, "Too Many Requests", 3));
      await linkPile();
      await expect(sendEntry(deps, await post())).rejects.toThrow(/429/);
    });
  });
});
