// What Kasa Bot's card says while an @kasa answer is on its way or didn't come (P-17).
// Petr approved this wording on 2026-09-29 (D-198, D-199).
import { BOT_ANSWER_STALE_MS } from "@kasa/shared";

export const BOT_CARD_TEXT: Record<string, string> = {
  pending: "On it. Looking through this pile…",
  failed: "I couldn't answer that just now. Tag @kasa again to retry.",
  paused: "I'm paused until next month, because I've used this month's budget. Everything else in Kasa works as usual.",
  limited: "That's a lot of questions for one day. I'll be back tomorrow.",
};

/** The thinking steps (D-199): reading the pile, then writing. */
export const readingText = (n: number) => `Reading ${n} ${n === 1 ? "entry" : "entries"}…`;
export const WRITING_TEXT = "Writing an answer…";
/** Above the composer while an answer is on its way. */
export const ANSWERING_TEXT = "Kasa Bot is answering…";
/** The reading step shows at least this long, so it doesn't flash past. */
export const READING_MIN_MS = 1000;

interface BotEntry {
  kind: string;
  body: string | null;
  botCard: string | null;
  botEntriesRead?: number | null;
  createdAt: string;
  deleted?: boolean;
  receipt?: { count: number; categories: string[] } | null;
}

/** "Stays", "Stays and Food", "Stays, Sights and Food". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** A sorting receipt (D-201): the first sort names the pile's categories; later ones count the burst. */
export const isReceipt = (entry: BotEntry) => entry.kind === "bot" && (entry.botCard === "sorted" || entry.botCard === "sorted-first");

/** The receipt's words around the category names, which the card shows in bold. */
export function receiptParts(entry: BotEntry): { before: string; names: string[]; after: string } | null {
  const r = entry.receipt;
  if (!isReceipt(entry) || !r || r.categories.length === 0) return null;
  if (entry.botCard === "sorted-first") return { before: "I sorted this pile into ", names: r.categories, after: "." };
  return { before: `Sorted ${r.count} new ${r.count === 1 ? "thing" : "things"} into `, names: r.categories, after: "." };
}

/** The worker hasn't finished this answer: it's waiting for the job, or the model is writing. */
export function isAnswerOpen(entry: BotEntry): boolean {
  return entry.kind === "bot" && !entry.deleted && (entry.botCard === "pending" || entry.botCard === "writing");
}

/** When an open answer stops counting as on its way, e.g. when no worker is running (D-199). */
export const staleAt = (entry: BotEntry) => new Date(entry.createdAt).getTime() + BOT_ANSWER_STALE_MS;

/** Open and not yet stale: show the thinking state. */
export function isAnswering(entry: BotEntry, now = Date.now()): boolean {
  return isAnswerOpen(entry) && now < staleAt(entry);
}

/** The card's text when it isn't thinking: the answer, the welcome text, or why there's no answer. */
export function botCardText(entry: BotEntry): string {
  if (isAnswerOpen(entry)) return BOT_CARD_TEXT.failed!;
  const parts = receiptParts(entry);
  if (parts) return `${parts.before}${listNames(parts.names)}${parts.after}`;
  return (entry.botCard && BOT_CARD_TEXT[entry.botCard]) || entry.body || "";
}
