// @mention autocomplete (D-164). Pure, so the composer can use it.

export interface Mentionable {
  id: string;
  name: string;
  /** Kasa Bot: picking it inserts "@kasa" and notifies no one by email. */
  bot?: boolean;
}

export const KASA_BOT: Mentionable = { id: "kasa-bot", name: "Kasa Bot", bot: true };

/** The "@query" being typed just before the caret, if any. */
export function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|\s)@([^\s@]{0,30})$/.exec(text.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[2]!.length - 1, query: match[2]! };
}

/** People whose first or any later name starts with the query, then Kasa Bot. */
export function matchMentions(candidates: Mentionable[], query: string, limit = 6): Mentionable[] {
  const q = query.toLowerCase();
  const words = (name: string) => name.toLowerCase().split(/\s+/);
  const matches = (c: Mentionable) => !q || words(c.name).some((w) => w.startsWith(q)) || (c.bot && "kasa".startsWith(q));
  return candidates.filter(matches).slice(0, limit);
}

export const mentionText = (c: Mentionable) => (c.bot ? "@kasa" : `@${c.name}`);

/** Replaces the "@query" with the picked name and a space. Returns the new text and caret. */
export function insertMention(text: string, at: { start: number; query: string }, picked: Mentionable): { text: string; caret: number } {
  const before = text.slice(0, at.start);
  const after = text.slice(at.start + 1 + at.query.length);
  const inserted = `${mentionText(picked)} `;
  return { text: `${before}${inserted}${after.replace(/^ /, "")}`, caret: before.length + inserted.length };
}

/** Ids of picked people whose "@Name" is still in the text; only these get an email (D-164). */
export function mentionIds(text: string, picked: Mentionable[]): string[] {
  return [...new Set(picked.filter((p) => !p.bot && text.includes(mentionText(p))).map((p) => p.id))];
}
