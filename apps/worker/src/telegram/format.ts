// What Kasa entries look like in the Telegram group (P-18, D-207): Telegram's own kinds, with
// the author's name first ("Mika: …"). Pure, so it's tested without Telegram.
import { MAX_CAPTION, MAX_TEXT } from "./api";

export interface OutgoingEntry {
  kind: string;
  author: string;
  body: string | null;
  url: string | null;
  ideas: { title: string; url: string }[];
}

/** The text of a note, link, or Kasa Bot answer; a photo's caption. */
export function formatEntry(e: OutgoingEntry): string {
  const said = (text: string) => `${e.author}: ${text}`;
  if (e.kind === "link") return said(e.url ?? "");
  if (e.kind === "photo") return (e.body ? said(e.body) : e.author).slice(0, MAX_CAPTION);
  const ideas = e.ideas.map((i) => `• ${i.title}: ${i.url}`);
  return [said(e.body ?? ""), ...(ideas.length ? ["", ...ideas] : [])].join("\n").slice(0, MAX_TEXT);
}

/** A Telegram user's display name: first and last name. */
export const telegramName = (user: { first_name: string; last_name?: string }) =>
  [user.first_name, user.last_name].filter(Boolean).join(" ").slice(0, 64) || "Someone";

/** "/start CODE" or "/start@bot CODE" → CODE; null for anything else. */
export function startCode(text: string | undefined, botUsername: string): string | null {
  const match = /^\/start(?:@(\w+))?\s+([A-Za-z0-9_-]{8,64})\s*$/.exec(text ?? "");
  if (!match) return null;
  if (match[1] && match[1].toLowerCase() !== botUsername.toLowerCase()) return null;
  return match[2]!;
}
