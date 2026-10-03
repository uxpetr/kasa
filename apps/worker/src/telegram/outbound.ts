// telegram.send (P-18, D-207): posts a Kasa entry to its pile's Telegram group, once. Posts,
// replies, and Kasa Bot's answers go; anything that came from Telegram never goes back, so
// nothing loops. Deleting in Kasa leaves the Telegram copy (D-015).
import { and, asc, eq, inArray, isNull, schema } from "@kasa/db";
import type { TelegramApi, TgMessage } from "./api";
import { TelegramError } from "./api";
import { formatEntry } from "./format";
import type { TelegramDeps } from "./inbound";

const SENT_KINDS = ["note", "link", "photo", "bot"] as const;

export async function sendEntry(deps: Omit<TelegramDeps, "queue" | "botUsername">, entryId: string): Promise<void> {
  const { db } = deps;
  const [entry] = await db
    .select({
      id: schema.entries.id,
      projectId: schema.entries.projectId,
      kind: schema.entries.kind,
      body: schema.entries.body,
      botCard: schema.entries.botCard,
      source: schema.entries.source,
      replyToId: schema.entries.replyToId,
      deletedAt: schema.entries.deletedAt,
      author: schema.users.name,
      chatId: schema.telegramLinks.chatId,
    })
    .from(schema.entries)
    .innerJoin(schema.telegramLinks, eq(schema.telegramLinks.projectId, schema.entries.projectId))
    .leftJoin(schema.users, eq(schema.users.id, schema.entries.authorId))
    .where(eq(schema.entries.id, entryId));
  if (!entry || entry.deletedAt || entry.source === "telegram" || !(SENT_KINDS as readonly string[]).includes(entry.kind)) return;
  // Kasa Bot: only finished answers, not receipts, welcome cards, or failed and waiting ones.
  if (entry.kind === "bot" && (entry.botCard !== null || !entry.replyToId)) return;
  const chatId = entry.chatId;
  const [sent] = await db.select({ id: schema.telegramMessages.messageId }).from(schema.telegramMessages).where(eq(schema.telegramMessages.entryId, entry.id)).limit(1);
  if (sent) return;

  const [quoted] = entry.replyToId
    ? await db
        .select({ messageId: schema.telegramMessages.messageId })
        .from(schema.telegramMessages)
        .where(and(eq(schema.telegramMessages.entryId, entry.replyToId), eq(schema.telegramMessages.chatId, chatId)))
        .orderBy(asc(schema.telegramMessages.messageId))
        .limit(1)
    : [];
  const opts = quoted ? { replyTo: Number(quoted.messageId) } : {};
  const [link] = entry.kind === "link" ? await db.select({ url: schema.linkPreviews.url }).from(schema.linkPreviews).where(eq(schema.linkPreviews.entryId, entry.id)) : [];
  const ideas =
    entry.kind === "bot"
      ? await db.select({ title: schema.botIdeas.title, url: schema.botIdeas.url }).from(schema.botIdeas).where(eq(schema.botIdeas.entryId, entry.id)).orderBy(asc(schema.botIdeas.position))
      : [];
  const text = formatEntry({ kind: entry.kind, author: entry.kind === "bot" ? "Kasa Bot" : (entry.author ?? "Someone"), body: entry.body, url: link?.url ?? null, ideas });

  let messages: TgMessage[];
  try {
    messages = entry.kind === "photo" ? await sendPhotos(deps, entry.id, chatId, text, opts) : [await deps.api.sendMessage(chatId, text, opts)];
  } catch (error) {
    if (error instanceof TelegramError && error.chatGone) {
      // The bot is out of the group: the link ends, the pile keeps everything.
      await db.delete(schema.telegramLinks).where(eq(schema.telegramLinks.chatId, chatId));
      deps.log?.info("telegram group unlinked", { "project.id": entry.projectId, reason: "send_refused" });
      return;
    }
    throw error;
  }
  if (messages.length) {
    await db
      .insert(schema.telegramMessages)
      .values(messages.map((m) => ({ entryId: entry.id, chatId, messageId: String(m.message_id), direction: "out" as const })))
      .onConflictDoNothing();
  }
  deps.log?.info("telegram sent", { "entry.id": entry.id, "project.id": entry.projectId, kind: entry.kind, messages: messages.length });
}

async function sendPhotos(deps: { db: TelegramDeps["db"]; storage: TelegramDeps["storage"]; api: TelegramApi }, entryId: string, chatId: string, caption: string, opts: { replyTo?: number }) {
  const media = await deps.db
    .select({ key: schema.entryMedia.storageKey, contentType: schema.uploads.contentType })
    .from(schema.entryMedia)
    .leftJoin(schema.uploads, eq(schema.uploads.id, schema.entryMedia.uploadId))
    .where(and(eq(schema.entryMedia.entryId, entryId), inArray(schema.entryMedia.role, ["photo"]), isNull(schema.uploads.failureReason)))
    .orderBy(asc(schema.entryMedia.position));
  const photos = await Promise.all(media.slice(0, 10).map(async (m) => ({ body: await deps.storage.read(m.key), contentType: m.contentType ?? "image/jpeg" })));
  if (photos.length === 0) return [await deps.api.sendMessage(chatId, caption, opts)];
  if (photos.length === 1) return [await deps.api.sendPhoto(chatId, photos[0]!, caption, opts)];
  return deps.api.sendMediaGroup(chatId, photos, caption, opts);
}
