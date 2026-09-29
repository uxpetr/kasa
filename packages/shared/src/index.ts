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
