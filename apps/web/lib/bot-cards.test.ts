import { BOT_ANSWER_STALE_MS } from "@kasa/shared";
import { describe, expect, it } from "vitest";
import { BOT_CARD_TEXT, botCardText, isAnswering, listNames, readingText, receiptParts } from "./bot-cards";

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

describe("sorting receipts (D-201)", () => {
  const receipt = (botCard: string, count: number, categories: string[]) => ({ kind: "bot", body: null, botCard, createdAt: new Date().toISOString(), receipt: { count, categories } });

  it("lists category names", () => {
    expect(listNames(["Sights"])).toBe("Sights");
    expect(listNames(["Stays", "Food"])).toBe("Stays and Food");
    expect(listNames(["Stays", "Sights", "Food"])).toBe("Stays, Sights and Food");
  });

  it("says what a burst sorted, and names the categories on the first sort", () => {
    expect(botCardText(receipt("sorted", 3, ["Sights"]))).toBe("Sorted 3 new things into Sights.");
    expect(botCardText(receipt("sorted", 1, ["Food"]))).toBe("Sorted 1 new thing into Food.");
    expect(botCardText(receipt("sorted", 5, ["Sights", "Food", "Stays"]))).toBe("Sorted 5 new things into Sights, Food and Stays.");
    expect(botCardText(receipt("sorted-first", 5, ["Stays", "Sights", "Food", "Getting around"]))).toBe(
      "I sorted this pile into Stays, Sights, Food and Getting around.",
    );
    // Nothing left in it (members moved everything): nothing to show.
    expect(receiptParts(receipt("sorted", 0, []))).toBeNull();
  });
});
