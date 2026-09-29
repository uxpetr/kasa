import { BOT_ANSWER_STALE_MS } from "@kasa/shared";
import { describe, expect, it } from "vitest";
import { BOT_CARD_TEXT, botCardText, isAnswering, readingText } from "./bot-cards";

const at = "2026-09-29T10:00:00.000Z";
const t0 = new Date(at).getTime();
const card = (botCard: string | null, body: string | null = null) => ({ kind: "bot", body, botCard, createdAt: at });

describe("Kasa Bot cards (D-198, D-199)", () => {
  it("counts entries in the reading step", () => {
    expect(readingText(1)).toBe("Reading 1 entry…");
    expect(readingText(24)).toBe("Reading 24 entries…");
  });

  it("thinks while pending or writing, until the answer goes stale", () => {
    expect(isAnswering(card("pending"), t0 + 1000)).toBe(true);
    expect(isAnswering(card("writing"), t0 + BOT_ANSWER_STALE_MS - 1)).toBe(true);
    expect(isAnswering(card("writing"), t0 + BOT_ANSWER_STALE_MS)).toBe(false);
    expect(isAnswering(card(null, "An answer"), t0)).toBe(false);
    expect(isAnswering({ ...card("pending"), deleted: true }, t0)).toBe(false);
    expect(isAnswering({ ...card("pending"), kind: "note" }, t0)).toBe(false);
  });

  it("shows the answer, the welcome text, a reason, or 'couldn't answer' once a stuck answer goes stale", () => {
    expect(botCardText(card(null, "Gion is closest."))).toBe("Gion is closest.");
    expect(botCardText(card("welcome", "Welcome to Kasa."))).toBe("Welcome to Kasa.");
    expect(botCardText(card("paused"))).toBe(BOT_CARD_TEXT.paused);
    expect(botCardText(card("pending"))).toBe(BOT_CARD_TEXT.failed);
  });
});
