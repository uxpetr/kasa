// Types, zod schemas, content-type definitions, and analytics event names.

export const ENTRY_SOURCES = ["app", "extension", "telegram"] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

export function isEntrySource(value: string): value is EntrySource {
  return (ENTRY_SOURCES as readonly string[]).includes(value);
}

export * from "./analytics";
