// What Kasa Bot's card says while an @kasa answer is on its way or didn't come (P-17).
// Petr approved this wording on 2026-09-29 (D-198).
export const BOT_CARD_TEXT: Record<string, string> = {
  pending: "On it. Looking through this pile…",
  failed: "I couldn't answer that just now. Tag @kasa again to retry.",
  paused: "I'm paused until next month, because I've used this month's budget. Everything else in Kasa works as usual.",
  limited: "That's a lot of questions for one day. I'll be back tomorrow.",
};

/** The card's text: the answer, the welcome text, or one of the states above. */
export function botCardText(entry: { body: string | null; botCard: string | null }): string {
  return (entry.botCard && BOT_CARD_TEXT[entry.botCard]) || entry.body || "";
}
