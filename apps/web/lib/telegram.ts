// Telegram sync in the web app (P-18, D-207): the webhook hands updates to the worker; owners link
// a pile to a group and members link their Telegram account, both through one-time codes that
// Telegram hands back to the bot. The bot token never reaches the browser, or this file.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { eq, schema, type Database } from "@kasa/db";
import { sendTelegram, type JobQueue } from "@kasa/jobs";
import { errorAttributes } from "@kasa/observability";
import { track } from "@kasa/shared";
import { canInvite, canRead, projectAccess } from "./access";
import { log } from "./log";
import { fail, isUuid, ok, type Result } from "./result";

/** How long an "Add Kasa Bot to a group" or "Link Telegram" link works. */
export const CODE_TTL_MS = 60 * 60_000;

/** The bot's username when Telegram is set up here, or null: the UI then offers nothing. */
export function telegramBot(env: Record<string, string | undefined> = process.env): string | null {
  return env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_USERNAME ? env.TELEGRAM_BOT_USERNAME.replace(/^@/, "") : null;
}

/** Whether a webhook call carries our secret, compared in constant time. False when none is set. */
export function webhookAuthorized(header: string | null, secret = process.env.TELEGRAM_WEBHOOK_SECRET): boolean {
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function newCode(db: Database, values: { kind: "group" | "account"; userId: string; projectId?: string }): Promise<string> {
  const code = randomBytes(16).toString("base64url");
  await db.insert(schema.telegramCodes).values({ ...values, code, expiresAt: new Date(Date.now() + CODE_TTL_MS) });
  return code;
}

export interface PileTelegram {
  /** Telegram is set up on this server. */
  available: boolean;
  /** The linked group's name, or null when the pile has none. */
  linked: { title: string | null } | null;
  /** The owner can link and unlink. */
  canLink: boolean;
}

export async function pileTelegram(db: Database, userId: string, projectId: string): Promise<Result<PileTelegram>> {
  if (!isUuid(projectId)) return fail(404, "Project not found");
  const access = await projectAccess(db, userId, projectId);
  if (!canRead(access)) return fail(404, "Project not found");
  const [link] = await db.select({ title: schema.telegramLinks.chatTitle }).from(schema.telegramLinks).where(eq(schema.telegramLinks.projectId, projectId));
  return ok({ available: telegramBot() !== null, linked: link ? { title: link.title } : null, canLink: canInvite(access) });
}

/** "Add Kasa Bot to a group": a link that opens Telegram's group picker with the bot and a code. Owner only. */
export async function groupLinkUrl(db: Database, userId: string, projectId: string): Promise<Result<{ url: string }>> {
  const bot = telegramBot();
  if (!bot) return fail(503, "Telegram isn't set up");
  if (!isUuid(projectId)) return fail(404, "Project not found");
  const access = await projectAccess(db, userId, projectId);
  if (!canRead(access)) return fail(404, "Project not found");
  if (!canInvite(access)) return fail(403, access!.archived ? "Project is archived" : "Only the owner can link Telegram");
  const code = await newCode(db, { kind: "group", userId, projectId });
  return ok({ url: `https://t.me/${bot}?startgroup=${code}` });
}

/** Unlink: the bot stops syncing; everything already in the pile and the group stays. Owner only. */
export async function unlinkPile(db: Database, userId: string, projectId: string): Promise<Result<{ ok: true }>> {
  if (!isUuid(projectId)) return fail(404, "Project not found");
  const access = await projectAccess(db, userId, projectId);
  if (!canRead(access)) return fail(404, "Project not found");
  if (access!.role !== "owner") return fail(403, "Only the owner can unlink Telegram");
  const removed = await db.delete(schema.telegramLinks).where(eq(schema.telegramLinks.projectId, projectId)).returning();
  if (removed.length) await track("telegram_unlinked", userId, { projectId, kind: "group" });
  return ok({ ok: true });
}

export async function accountTelegram(db: Database, userId: string): Promise<{ available: boolean; linked: boolean }> {
  const [identity] = await db.select({ id: schema.telegramIdentities.userId }).from(schema.telegramIdentities).where(eq(schema.telegramIdentities.userId, userId));
  return { available: telegramBot() !== null, linked: !!identity };
}

/** "Link Telegram": opens a private chat with the bot; pressing Start links the account. */
export async function accountLinkUrl(db: Database, userId: string): Promise<Result<{ url: string }>> {
  const bot = telegramBot();
  if (!bot) return fail(503, "Telegram isn't set up");
  const code = await newCode(db, { kind: "account", userId });
  return ok({ url: `https://t.me/${bot}?start=${code}` });
}

export async function unlinkAccount(db: Database, userId: string): Promise<void> {
  await db.delete(schema.telegramIdentities).where(eq(schema.telegramIdentities.userId, userId));
  await track("telegram_unlinked", userId, { kind: "account" });
}

/** Queues an entry for the pile's Telegram group, when it has one. Never fails the caller. */
export async function queueTelegram(db: Database, jobs: JobQueue, projectId: string, entryId: string): Promise<void> {
  try {
    const [link] = await db.select({ chatId: schema.telegramLinks.chatId }).from(schema.telegramLinks).where(eq(schema.telegramLinks.projectId, projectId));
    if (link) await sendTelegram(jobs, entryId);
  } catch (error) {
    log.error("telegram send not queued", { "entry.id": entryId, "project.id": projectId, ...errorAttributes(error) });
  }
}
