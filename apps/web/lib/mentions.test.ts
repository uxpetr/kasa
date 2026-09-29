import { describe, expect, it } from "vitest";
import { activeMention, insertMention, KASA_BOT, matchMentions, mentionIds, tagsKasa } from "./mentions";

const mika = { id: "u-mika", name: "Mika Tanaka" };
const aiko = { id: "u-aiko", name: "Aiko" };
const all = [mika, aiko, KASA_BOT];

describe("mentions", () => {
  it("finds the @query before the caret, only at a word start", () => {
    expect(activeMention("hey @mi", 7)).toEqual({ start: 4, query: "mi" });
    expect(activeMention("@", 1)).toEqual({ start: 0, query: "" });
    expect(activeMention("mail me@example", 15)).toBeNull();
    expect(activeMention("hey @mika and", 13)).toBeNull();
    expect(activeMention("hey @mi more", 7)).toEqual({ start: 4, query: "mi" });
  });

  it("matches any word of a name, and @kasa for the bot", () => {
    expect(matchMentions(all, "")).toEqual(all);
    expect(matchMentions(all, "ta")).toEqual([mika]);
    expect(matchMentions(all, "A")).toEqual([aiko]);
    expect(matchMentions(all, "kas")).toEqual([KASA_BOT]);
    expect(matchMentions(all, "zz")).toEqual([]);
  });

  it("inserts the full name with a trailing space", () => {
    expect(insertMention("hey @mi", { start: 4, query: "mi" }, mika)).toEqual({ text: "hey @Mika Tanaka ", caret: 17 });
    expect(insertMention("@ka what now", { start: 0, query: "ka" }, KASA_BOT)).toEqual({ text: "@kasa what now", caret: 6 });
  });

  it("notifies only picked people still in the text, never the bot", () => {
    expect(mentionIds("@Mika Tanaka and @Aiko", [mika, aiko, KASA_BOT])).toEqual(["u-mika", "u-aiko"]);
    expect(mentionIds("@Mika Tanaka", [mika, aiko])).toEqual(["u-mika"]);
    expect(mentionIds("@kasa help", [KASA_BOT])).toEqual([]);
    expect(mentionIds("I typed @Aiko myself", [])).toEqual([]);
    const jo = { id: "u-jo", name: "Jo" };
    expect(mentionIds("@John Smith", [jo, { id: "u-john", name: "John Smith" }])).toEqual(["u-john"]);
    expect(mentionIds("email me@Aiko.com", [aiko])).toEqual([]);
    expect(mentionIds("@Mika Tanaka's idea (@Aiko)", [mika, aiko])).toEqual(["u-mika", "u-aiko"]);
  });
});

describe("tagsKasa (P-17)", () => {
  it.each([
    ["@kasa hi", true],
    ["hi @Kasa", true],
    ["(@kasa)", true],
    ["@kasa, any ideas?", true],
    ["mail hello@kasa.com", false],
    ["@kasabot", false],
    ["@@kasa", false],
    ["kasa", false],
  ])("%s", (text, expected) => {
    expect(tagsKasa(text)).toBe(expected);
  });
});
