// Sample data for the views preview (F-19). Nothing here touches the database: the pages pass it
// to the real view components, and the preview API in ./api answers their requests from it.
import type { CategoryChipData } from "@/lib/categories";
import type { FeedEntry, FeedIdea, FeedPage } from "@/lib/entries";
import type { Pile } from "@/lib/piles";
import { PERSONAL_PROJECT_NAME, WELCOME_TEXT } from "@/lib/projects";
import { EMPTY_PILE_ID, MY_PILE_ID, PILE_ID } from "./fixture-ids";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const people = {
  you: { id: "preview-you", name: "Ren" },
  mika: { id: "preview-mika", name: "Mika" },
  aiko: { id: "preview-aiko", name: "Aiko" },
  jun: { id: "preview-jun", name: "Jun" },
};

export { EMPTY_PILE_ID, MY_PILE_ID, PILE_ID };
export const PILE_NAME = "Japan 2027";

/** Sample photos in /public/samples, served as uploads by the preview API. */
export const SAMPLE_PHOTOS = ["kinkakuji", "kiyomizu", "osaka-castle", "tokyo-fuji", "higashiyama"] as const;

export const categories: CategoryChipData[] = [
  { id: "cat-stays", name: "Stays", count: 1 },
  { id: "cat-sights", name: "Sights", count: 3 },
  { id: "cat-food", name: "Food", count: 2 },
];
const cat = (id: string) => categories.find((c) => c.id === id)!;

/** A feed entry with every field the sample doesn't set left empty. */
export function entry(fields: Partial<FeedEntry> & Pick<FeedEntry, "id" | "kind" | "createdAt">): FeedEntry {
  return {
    body: null,
    botCard: null,
    botEntriesRead: null,
    author: null,
    deleted: false,
    deletedBy: null,
    photos: [],
    link: null,
    capture: null,
    reactions: [],
    replyTo: null,
    categories: [],
    receipt: null,
    ideas: [],
    fromBot: false,
    source: "app",
    guest: null,
    ...fields,
  };
}

const ideas: FeedIdea[] = [
  {
    id: "idea-1",
    url: "https://example.com/ryokan-sakura",
    title: "Ryokan Sakura, Higashiyama",
    note: "Private onsen and a kaiseki dinner, ten minutes' walk from Kiyomizu-dera.",
    siteName: "example.com",
    hasImage: true,
    added: { entryId: "e-link", category: "Stays" },
  },
  {
    id: "idea-2",
    url: "https://example.com/arashiyama-house",
    title: "Arashiyama riverside house",
    note: "Quieter, by the bamboo grove; better for an early start.",
    siteName: "example.com",
    hasImage: true,
    added: null,
  },
  {
    id: "idea-3",
    url: "https://example.com/gion-machiya",
    title: "Gion machiya stay",
    note: null,
    siteName: "example.com",
    hasImage: false,
    added: null,
  },
];

/** The main pile: one of every content type the feed shows, over three days. */
export function feedEntries(now: number): FeedEntry[] {
  const at = (ago: number) => new Date(now - ago).toISOString();
  const question = entry({
    id: "e-question",
    kind: "note",
    body: "@kasa where should we stay the last night in Kyoto? Somewhere with an onsen?",
    author: people.mika,
    createdAt: at(DAY + 3 * HOUR),
  });
  const plan = entry({
    id: "e-plan",
    kind: "note",
    body: "Rough plan: Tokyo for four nights, then the Shinkansen to Kyoto. Osaka as a day trip, unless someone really wants to stay there.",
    author: people.you,
    createdAt: at(2 * DAY + 5 * HOUR),
    reactions: [
      { emoji: "👍", count: 2, mine: false },
      { emoji: "❤️", count: 1, mine: true },
    ],
  });
  const link = entry({
    id: "e-link",
    kind: "link",
    author: people.you,
    link: { url: "https://example.com/ryokan-sakura", title: "Ryokan Sakura, Higashiyama", siteName: "example.com", hasImage: true },
    fromBot: true,
    createdAt: at(DAY + 2 * HOUR),
    categories: [cat("cat-stays")],
  });
  return [
    plan,
    entry({
      id: "e-long",
      kind: "note",
      body: "Things I'd like to fit in somewhere, in no order: the fish market at dawn, one proper kaiseki dinner, a night walk through Gion, the golden pavilion before the crowds, Fushimi Inari as high as our legs allow, an onsen at least once, and a whole afternoon with no plan at all. Also somebody please book the Ghibli museum the day tickets open.",
      author: people.aiko,
      createdAt: at(2 * DAY + 4 * HOUR),
      categories: [cat("cat-sights")],
    }),
    entry({
      id: "e-photo",
      kind: "photo",
      body: "Pond at 8am",
      author: people.mika,
      photos: [{ uploadId: "kinkakuji", width: 1200, height: 800 }],
      createdAt: at(2 * DAY + 2 * HOUR),
      categories: [cat("cat-sights")],
      reactions: [{ emoji: "😮", count: 3, mine: true }],
    }),
    entry({
      id: "e-album",
      kind: "photo",
      author: people.jun,
      photos: [
        { uploadId: "osaka-castle", width: 1200, height: 900 },
        { uploadId: "kiyomizu", width: 1200, height: 800 },
        { uploadId: "tokyo-fuji", width: 1200, height: 800 },
      ],
      createdAt: at(2 * DAY + HOUR),
      categories: [cat("cat-sights")],
    }),
    entry({
      id: "e-receipt",
      kind: "bot",
      botCard: "sorted-first",
      receipt: { count: 5, categories: ["Stays", "Sights", "Food"] },
      createdAt: at(2 * DAY + 50 * MIN),
    }),
    question,
    entry({
      id: "e-answer",
      kind: "bot",
      body: "For the last night, Higashiyama is the easiest: you can walk to Kiyomizu-dera in the morning and still make the train. Three places with an onsen:",
      replyTo: question,
      ideas,
      createdAt: at(DAY + 3 * HOUR - 2 * MIN),
    }),
    link,
    entry({
      id: "e-reply",
      kind: "note",
      body: "Yes to this one. The private onsen is worth it.",
      author: people.aiko,
      replyTo: link,
      createdAt: at(DAY + HOUR),
    }),
    entry({
      id: "e-guest",
      kind: "note",
      body: "Ramen tip from my cousin: Ichiran in Shibuya is open all night 🍜",
      guest: "Kenji",
      source: "telegram",
      createdAt: at(5 * HOUR),
      categories: [cat("cat-food")],
    }),
    entry({
      id: "e-deleted",
      kind: "photo",
      author: people.jun,
      deleted: true,
      deletedBy: people.jun,
      createdAt: at(4 * HOUR),
    }),
    entry({
      id: "e-food",
      kind: "note",
      body: "Booked Nishiki market for the Thursday morning ✅",
      author: people.mika,
      source: "telegram",
      createdAt: at(40 * MIN),
      categories: [cat("cat-food")],
    }),
  ];
}

/** The same pile while Kasa Bot is answering (P-17): the question and the thinking card. */
export function answeringEntries(now: number): FeedEntry[] {
  const all = feedEntries(now).slice(0, 6);
  const question = entry({
    id: "e-ask",
    kind: "note",
    body: "@kasa which day works best for Nara?",
    author: people.you,
    createdAt: new Date(now - 4_000).toISOString(),
  });
  return [
    ...all,
    question,
    entry({ id: "e-thinking", kind: "bot", botCard: "pending", botEntriesRead: 12, replyTo: question, createdAt: new Date(now - 3_000).toISOString() }),
  ];
}

/** First run (D-180): My pile with Kasa Bot's welcome card. */
export function welcomeEntries(now: number): FeedEntry[] {
  return [
    entry({
      id: "e-welcome",
      kind: "bot",
      botCard: "welcome",
      body: WELCOME_TEXT,
      createdAt: new Date(now - 2 * MIN).toISOString(),
    }),
  ];
}

export function page(entries: FeedEntry[], { withCategories = true } = {}): FeedPage {
  return {
    entries,
    nextCursor: null,
    syncedAt: new Date().toISOString(),
    categories: withCategories ? categories : [],
    postCount: entries.filter((e) => e.kind !== "bot" && !e.deleted).length,
  };
}

/** Which entries a pile's feed starts with; the preview API serves the same ones. */
export function entriesFor(projectId: string, now: number): FeedEntry[] {
  if (projectId === MY_PILE_ID) return welcomeEntries(now);
  if (projectId === EMPTY_PILE_ID) return [];
  return feedEntries(now);
}

export function piles(now: number): Pile[] {
  const base = { role: "owner" as const, archivedAt: null, createdAt: new Date(now - 30 * DAY) };
  return [
    {
      ...base,
      id: PILE_ID,
      name: PILE_NAME,
      memberCount: 4,
      members: [people.you, people.mika, people.aiko, people.jun],
      preview: "Mika: Booked Nishiki market for the Thursday morning ✅",
      peekUrl: "/samples/kinkakuji.jpg",
      unread: 3,
      entryCount: 12,
      activeAt: new Date(now - 40 * MIN),
    },
    {
      ...base,
      id: "00000000-0000-4000-8000-00000000a004",
      name: "Aiko's wedding",
      role: "editor",
      memberCount: 6,
      members: [people.aiko, people.you, people.mika, people.jun, { id: "p5", name: "Sora" }, { id: "p6", name: "Hana" }],
      preview: "Aiko: Venue shortlist is in, have a look before Friday",
      peekUrl: null,
      unread: 0,
      entryCount: 31,
      activeAt: new Date(now - 2 * DAY),
    },
    {
      ...base,
      id: "00000000-0000-4000-8000-00000000a005",
      name: "Kitchen redo",
      memberCount: 2,
      members: [people.you, people.jun],
      preview: "Jun shared a link: Oak worktops, three finishes",
      peekUrl: "/samples/higashiyama.jpg",
      unread: 1,
      entryCount: 9,
      activeAt: new Date(now - 5 * DAY),
    },
    {
      ...base,
      id: MY_PILE_ID,
      name: PERSONAL_PROJECT_NAME,
      memberCount: 1,
      members: [people.you],
      preview: null,
      peekUrl: null,
      unread: 0,
      entryCount: 7,
      activeAt: new Date(now - 9 * DAY),
    },
    {
      ...base,
      id: "00000000-0000-4000-8000-00000000a006",
      name: "Lisbon weekend",
      archivedAt: new Date(now - 60 * DAY),
      memberCount: 3,
      members: [people.you, people.mika, people.aiko],
      preview: "Mika: Thanks all, what a trip",
      peekUrl: null,
      unread: 0,
      entryCount: 24,
      activeAt: new Date(now - 70 * DAY),
    },
  ];
}

export const members = [
  { ...people.you, role: "owner" as const },
  { ...people.mika, role: "editor" as const },
  { ...people.aiko, role: "editor" as const },
  { ...people.jun, role: "viewer" as const },
];
