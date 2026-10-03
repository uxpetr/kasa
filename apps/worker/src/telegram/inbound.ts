// telegram.update (P-18, D-207): what arrives from Telegram. /start codes link a group to a pile
// or a Telegram account to a Kasa account; messages in a linked group land in that pile only.
// Messages from groups that aren't linked are ignored, whatever they say.
import { randomUUID } from "node:crypto";
import { and, count, eq, gt, inArray, isNull, ne, or, schema, sql, type Database } from "@kasa/db";
import { sendSort, type JobQueue } from "@kasa/jobs";
import { isImageType, keys, MAX_UPLOAD_BYTES, type Storage } from "@kasa/media";
import type { Logger } from "@kasa/observability";
import { BOT_MAX_CONTEXT_ENTRIES, soleUrl, tagsKasa, track } from "@kasa/shared";
import { processUpload } from "../media";
import type { TelegramApi, TgMessage, TgUpdate } from "./api";
import { startCode, telegramName } from "./format";

/** As in the app composer (P-03). */
const MAX_ENTRY_TEXT = 4000;

export interface TelegramDeps {
  db: Database;
  api: TelegramApi;
  storage: Storage;
  queue: JobQueue;
  /** Without the @, e.g. kasa_piles_bot. */
  botUsername: string;
  log?: Logger;
  now?: () => Date;
}

/** Bot replies in Telegram. Petr to confirm the wording (D-208). */
export const SAY = {
  groupLinked: (pile: string) => `Linked to the ${pile} pile in Kasa. Posts here go to the pile, and the pile's posts come here.`,
  groupTaken: "This group is already linked to another Kasa pile.",
  pileTaken: "That pile is already linked to another group. Unlink it in Kasa first.",
  codeExpired: "That link has expired. Get a new one in Kasa.",
  accountLinked: (name: string) => `Done. Your Telegram is linked to ${name} in Kasa.`,
  hello: "Hi! I'm Kasa Bot. To link your Telegram, open Kasa and choose Link Telegram in your account menu.",
  guestHint: (name: string, pile: string) =>
    `${name}, I added this to ${pile} as a guest. To post as yourself, open Kasa and choose Link Telegram in your account menu.`,
};

export async function handleUpdate(deps: TelegramDeps, update: TgUpdate): Promise<void> {
  if (update.my_chat_member) {
    const { chat, new_chat_member: member } = update.my_chat_member;
    // Removed from the group: the link ends; the pile keeps its entries.
    if (member.user.username?.toLowerCase() === deps.botUsername.toLowerCase() && ["left", "kicked"].includes(member.status)) {
      await unlinkChat(deps, String(chat.id), "removed");
    }
    return;
  }
  if (update.edited_message) return applyEdit(deps, update.edited_message);
  const message = update.message;
  if (!message) return;

  if (message.migrate_to_chat_id) {
    // A group upgraded to a supergroup gets a new id; follow it.
    const from = String(message.chat.id);
    const to = String(message.migrate_to_chat_id);
    await deps.db.transaction(async (tx) => {
      await tx.update(schema.telegramLinks).set({ chatId: to }).where(eq(schema.telegramLinks.chatId, from));
      await tx.update(schema.telegramMessages).set({ chatId: to }).where(eq(schema.telegramMessages.chatId, from));
      await tx.update(schema.telegramGuestHints).set({ chatId: to }).where(eq(schema.telegramGuestHints.chatId, from));
    });
    return;
  }

  const code = startCode(message.text, deps.botUsername);
  if (message.chat.type === "private") {
    if (code) return linkAccount(deps, message, code);
    if (message.text?.startsWith("/start")) await deps.api.sendMessage(String(message.chat.id), SAY.hello);
    return;
  }
  if (message.chat.type !== "group" && message.chat.type !== "supergroup") return;
  if (code) return linkGroup(deps, message, code);
  await ingest(deps, message);
}

async function useCode(db: Database, code: string, kind: "group" | "account", now: Date) {
  const [row] = await db
    .update(schema.telegramCodes)
    .set({ usedAt: now })
    .where(and(eq(schema.telegramCodes.code, code), eq(schema.telegramCodes.kind, kind), isNull(schema.telegramCodes.usedAt), gt(schema.telegramCodes.expiresAt, now)))
    .returning();
  return row ?? null;
}

async function linkGroup(deps: TelegramDeps, message: TgMessage, code: string) {
  const { db } = deps;
  const chatId = String(message.chat.id);
  const used = await useCode(db, code, "group", deps.now?.() ?? new Date());
  // Only the pile's owner can link it, and only while they still own it.
  const [pile] = used?.projectId
    ? await db
        .select({ id: schema.projects.id, name: schema.projects.name })
        .from(schema.projects)
        .innerJoin(schema.memberships, eq(schema.memberships.projectId, schema.projects.id))
        .where(
          and(
            eq(schema.projects.id, used.projectId),
            isNull(schema.projects.deletedAt),
            eq(schema.memberships.userId, used.userId),
            eq(schema.memberships.role, "owner"),
          ),
        )
    : [];
  if (!used || !pile) return void (await deps.api.sendMessage(chatId, SAY.codeExpired));

  const [byChat] = await db.select().from(schema.telegramLinks).where(eq(schema.telegramLinks.chatId, chatId));
  if (byChat && byChat.projectId !== pile.id) return void (await deps.api.sendMessage(chatId, SAY.groupTaken));
  const [byPile] = await db.select().from(schema.telegramLinks).where(eq(schema.telegramLinks.projectId, pile.id));
  if (byPile && byPile.chatId !== chatId) return void (await deps.api.sendMessage(chatId, SAY.pileTaken));
  await db
    .insert(schema.telegramLinks)
    .values({ projectId: pile.id, chatId, chatTitle: message.chat.title ?? null, linkedBy: used.userId })
    .onConflictDoUpdate({ target: schema.telegramLinks.projectId, set: { chatTitle: message.chat.title ?? null } });
  await deps.api.sendMessage(chatId, SAY.groupLinked(pile.name));
  await track("telegram_linked", used.userId, { projectId: pile.id, kind: "group" });
  deps.log?.info("telegram group linked", { "project.id": pile.id });
}

async function linkAccount(deps: TelegramDeps, message: TgMessage, code: string) {
  const { db } = deps;
  const chatId = String(message.chat.id);
  const used = await useCode(db, code, "account", deps.now?.() ?? new Date());
  if (!used || !message.from) return void (await deps.api.sendMessage(chatId, SAY.codeExpired));
  const telegramUserId = String(message.from.id);
  // One Telegram account per Kasa account, and the other way round: the newest link wins.
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.telegramIdentities)
      .where(or(eq(schema.telegramIdentities.userId, used.userId), eq(schema.telegramIdentities.telegramUserId, telegramUserId)));
    await tx.insert(schema.telegramIdentities).values({ userId: used.userId, telegramUserId });
  });
  const [user] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, used.userId));
  await deps.api.sendMessage(chatId, SAY.accountLinked(user?.name ?? "you"));
  await track("telegram_linked", used.userId, { kind: "account" });
}

async function unlinkChat(deps: TelegramDeps, chatId: string, reason: string) {
  const removed = await deps.db.delete(schema.telegramLinks).where(eq(schema.telegramLinks.chatId, chatId)).returning();
  for (const link of removed) deps.log?.info("telegram group unlinked", { "project.id": link.projectId, reason });
}

/** Who wrote it: a linked Kasa account that's in this pile, or a guest by their Telegram name. */
async function authorOf(db: Database, projectId: string, message: TgMessage): Promise<{ authorId: string | null; guestName: string | null }> {
  if (!message.from) return { authorId: null, guestName: "Someone" };
  const [member] = await db
    .select({ userId: schema.telegramIdentities.userId })
    .from(schema.telegramIdentities)
    .innerJoin(schema.memberships, eq(schema.memberships.userId, schema.telegramIdentities.userId))
    .where(and(eq(schema.telegramIdentities.telegramUserId, String(message.from.id)), eq(schema.memberships.projectId, projectId)));
  return member ? { authorId: member.userId, guestName: null } : { authorId: null, guestName: telegramName(message.from) };
}

/** The image to take from a message: the largest photo size, or an image sent as a file. */
function imageOf(message: TgMessage): { fileId: string; contentType: string } | null {
  if (message.photo?.length) {
    const largest = message.photo.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
    return { fileId: largest.file_id, contentType: "image/jpeg" };
  }
  const doc = message.document;
  if (doc?.mime_type && isImageType(doc.mime_type) && (doc.file_size ?? 0) <= MAX_UPLOAD_BYTES) return { fileId: doc.file_id, contentType: doc.mime_type };
  return null;
}

/** Downloads a Telegram image and processes it like an app upload (F-06): metadata stripped, thumbnail made. */
async function uploadFromTelegram(deps: TelegramDeps, projectId: string, uploaderId: string | null, image: { fileId: string; contentType: string }) {
  const file = await deps.api.downloadFile(image.fileId);
  if (file.body.length > MAX_UPLOAD_BYTES) return null;
  const id = randomUUID();
  await deps.db.insert(schema.uploads).values({ id, projectId, uploaderId, contentType: image.contentType, size: file.body.length, status: "processing" });
  await deps.storage.write(keys.raw(projectId, id), file.body, image.contentType);
  await processUpload({ db: deps.db, storage: deps.storage, log: deps.log }, id);
  const [upload] = await deps.db.select().from(schema.uploads).where(eq(schema.uploads.id, id));
  return upload?.status === "ready" && upload.fullKey ? upload : null;
}

async function ingest(deps: TelegramDeps, message: TgMessage) {
  const { db } = deps;
  const chatId = String(message.chat.id);
  const [link] = await db
    .select({ projectId: schema.telegramLinks.projectId, pile: schema.projects.name, botMode: schema.projects.botMode })
    .from(schema.telegramLinks)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.telegramLinks.projectId))
    .where(and(eq(schema.telegramLinks.chatId, chatId), isNull(schema.projects.deletedAt)));
  if (!link || message.from?.is_bot) return;
  const projectId = link.projectId;
  const messageId = String(message.message_id);
  const [seen] = await db
    .select({ entryId: schema.telegramMessages.entryId })
    .from(schema.telegramMessages)
    .where(and(eq(schema.telegramMessages.chatId, chatId), eq(schema.telegramMessages.messageId, messageId)));
  if (seen) return;

  const text = (message.text ?? message.caption ?? "").trim().slice(0, MAX_ENTRY_TEXT);
  const image = imageOf(message);
  if (!image && !text) return;
  const { authorId, guestName } = await authorOf(db, projectId, message);
  const upload = image ? await uploadFromTelegram(deps, projectId, authorId, image) : null;
  if (image && !upload && !text) return;

  const url = upload ? null : soleUrl(text);
  const kind = upload ? "photo" : url ? "link" : "note";
  const replyId = message.reply_to_message ? String(message.reply_to_message.message_id) : null;
  const [original] = replyId
    ? await db
        .select({ entryId: schema.telegramMessages.entryId })
        .from(schema.telegramMessages)
        .innerJoin(schema.entries, eq(schema.entries.id, schema.telegramMessages.entryId))
        .where(and(eq(schema.telegramMessages.chatId, chatId), eq(schema.telegramMessages.messageId, replyId), eq(schema.entries.projectId, projectId), isNull(schema.entries.deletedAt)))
    : [];

  const result = await db.transaction(async (tx) => {
    // An album's photos arrive one message each; they make one photo entry.
    if (upload && message.media_group_id) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${chatId}:${message.media_group_id}`}))`);
      const [album] = await tx
        .select({ entryId: schema.telegramMessages.entryId })
        .from(schema.telegramMessages)
        .where(and(eq(schema.telegramMessages.chatId, chatId), eq(schema.telegramMessages.mediaGroupId, message.media_group_id)));
      if (album) {
        const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(schema.entryMedia).where(eq(schema.entryMedia.entryId, album.entryId));
        if (n < 10) {
          await tx.insert(schema.entryMedia).values({ entryId: album.entryId, uploadId: upload.id, storageKey: upload.fullKey!, width: upload.width, height: upload.height, role: "photo", position: n });
        }
        if (text) await tx.update(schema.entries).set({ body: text }).where(and(eq(schema.entries.id, album.entryId), isNull(schema.entries.body)));
        await tx.insert(schema.telegramMessages).values({ entryId: album.entryId, chatId, messageId, direction: "in", mediaGroupId: message.media_group_id });
        return null;
      }
    }
    const [entry] = await tx
      .insert(schema.entries)
      .values({ projectId, authorId, guestName, kind, body: kind === "link" ? null : text || null, source: "telegram", replyToId: original?.entryId ?? null })
      .returning({ id: schema.entries.id });
    const entryId = entry!.id;
    if (upload) {
      await tx.insert(schema.entryMedia).values({ entryId, uploadId: upload.id, storageKey: upload.fullKey!, width: upload.width, height: upload.height, role: "photo", position: 0 });
    }
    if (url) await tx.insert(schema.linkPreviews).values({ entryId, url });
    await tx.insert(schema.telegramMessages).values({ entryId, chatId, messageId, direction: "in", mediaGroupId: message.media_group_id ?? null });
    // @kasa (or @the_bot) asks Kasa Bot, as in the app: one pile, same limits (D-207).
    const asks = link.botMode !== "off" && kind !== "link" && (tagsKasa(text) || new RegExp(`@${deps.botUsername}\\b`, "i").test(text));
    const botEntryId = asks ? await insertPendingCard(tx, projectId, entryId) : null;
    return { entryId, botEntryId };
  });
  if (!result) return;

  if (url) await deps.queue.send("link.unfurl", { entryId: result.entryId });
  else if (!original && link.botMode !== "off") await sendSort(deps.queue, projectId);
  if (result.botEntryId) await deps.queue.send("bot.answer", { entryId: result.botEntryId });
  await track("entry_created", authorId, { projectId, entryId: result.entryId, kind, source: "telegram", guest: !authorId });
  if (original) await track("reply_created", authorId, { projectId, entryId: result.entryId, replyToId: original.entryId, kind, source: "telegram" });

  // Once per guest per group: how to post as themselves.
  if (!authorId && message.from) {
    const hinted = await db
      .insert(schema.telegramGuestHints)
      .values({ chatId, telegramUserId: String(message.from.id) })
      .onConflictDoNothing()
      .returning();
    if (hinted.length) await deps.api.sendMessage(chatId, SAY.guestHint(message.from.first_name, link.pile), { replyTo: message.message_id });
  }
}

/** An edited Telegram message updates its note or caption in the pile (D-207). Links keep their URL. */
async function applyEdit(deps: TelegramDeps, message: TgMessage) {
  const text = (message.text ?? message.caption ?? "").trim().slice(0, MAX_ENTRY_TEXT);
  const [mapped] = await deps.db
    .select({ entryId: schema.telegramMessages.entryId })
    .from(schema.telegramMessages)
    .where(and(eq(schema.telegramMessages.chatId, String(message.chat.id)), eq(schema.telegramMessages.messageId, String(message.message_id)), eq(schema.telegramMessages.direction, "in")));
  if (!mapped) return;
  await deps.db
    .update(schema.entries)
    .set({ body: text || null })
    .where(and(eq(schema.entries.id, mapped.entryId), inArray(schema.entries.kind, ["note", "photo"]), isNull(schema.entries.deletedAt), ...(text ? [] : [eq(schema.entries.kind, "photo")])));
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** A pending Kasa Bot card, as the web app makes one for an @kasa post (P-17, D-199). */
async function insertPendingCard(tx: Tx, projectId: string, questionId: string): Promise<string> {
  const [readable] = await tx
    .select({ n: count() })
    .from(schema.entries)
    .where(and(eq(schema.entries.projectId, projectId), isNull(schema.entries.deletedAt), or(ne(schema.entries.kind, "bot"), isNull(schema.entries.botCard))));
  const [bot] = await tx
    .insert(schema.entries)
    .values({ projectId, authorId: null, kind: "bot", replyToId: questionId, botCard: "pending", botEntriesRead: Math.min(readable?.n ?? 0, BOT_MAX_CONTEXT_ENTRIES), createdAt: sql`clock_timestamp()` })
    .returning({ id: schema.entries.id });
  return bot!.id;
}
