// Types, zod schemas, content-type definitions, and analytics event names.

export const ENTRY_SOURCES = ["app", "extension", "telegram"] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

export function isEntrySource(value: string): value is EntrySource {
  return (ENTRY_SOURCES as readonly string[]).includes(value);
}

export * from "./analytics";

/** Kasa Bot reads a pile's newest entries, at most this many (P-17, D-199). */
export const BOT_MAX_CONTEXT_ENTRIES = 200;
/** A bot answer still pending after this long is treated as failed on screen (D-199). */
export const BOT_ANSWER_STALE_MS = 120_000;

// Kasa Bot categories (P-19, D-201).
/** A pile gets its first categories once it has this many things to sort. */
export const SORT_START_AT = 5;
/** Kasa Bot adds categories only up to this many per pile; members can add more. */
export const BOT_MAX_CATEGORIES = 7;
/** Categories per pile, including members' own. */
export const MAX_CATEGORIES = 20;
export const MAX_CATEGORY_NAME = 30;
/** A sorting receipt keeps growing until this long passes with nothing new sorted. */
export const RECEIPT_BURST_MS = 10 * 60_000;
/** The kinds Kasa Bot sorts: people's posts, not replies or bot cards. */
export const SORTABLE_KINDS = ["note", "photo", "link", "capture", "drawing", "file", "decision"] as const;
