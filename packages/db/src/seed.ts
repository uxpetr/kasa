// Seeds the "Japan 2027" demo project from design/prototype/Main.dc.html.
// Safe to re-run: it removes the previous demo project and users first.
import { eq, inArray } from "drizzle-orm";
import { createDb, requireDatabaseUrl, type Database } from "./client";
import * as s from "./schema";

// Fixed ids so the demo is stable across re-seeds and easy to link to.
export const SEED = {
  projectId: "00000000-0000-4000-8000-000000000001",
  users: {
    petr: "00000000-0000-4000-8000-0000000000a1",
    aiko: "00000000-0000-4000-8000-0000000000a2",
    mika: "00000000-0000-4000-8000-0000000000a3",
    jonas: "00000000-0000-4000-8000-0000000000a4",
  },
} as const;

const seedUserIds = Object.values(SEED.users);

/**
 * A clock time "yesterday" (`day = -1`) or "today" (`day = 0`), as in the prototype.
 * Before the last demo entry (10:06), "today" moves back a day so nothing is in the future.
 */
function at(now: Date, day: 0 | -1, hh: number, mm: number): Date {
  const d = new Date(now);
  const lastEntry = new Date(now);
  lastEntry.setHours(10, 6, 0, 0);
  const shift = now < lastEntry ? -1 : 0;
  d.setDate(d.getDate() + day + shift);
  d.setHours(hh, mm, 0, 0);
  return d;
}

export async function seed(db: Database, now = new Date()) {
  await db.transaction(async (tx) => {
    await tx.delete(s.projects).where(eq(s.projects.id, SEED.projectId));
    await tx.delete(s.users).where(inArray(s.users.id, seedUserIds));

    const { petr, aiko, mika, jonas } = SEED.users;
    await tx.insert(s.users).values([
      { id: petr, email: "petr@example.com", name: "Petr" },
      { id: aiko, email: "aiko@example.com", name: "Aiko" },
      { id: mika, email: "mika@example.com", name: "Mika" },
      { id: jonas, email: "jonas@example.com", name: "Jonas" },
    ]);

    const projectId = SEED.projectId;
    await tx.insert(s.projects).values({ id: projectId, name: "Japan 2027", ownerId: petr, botMode: "tagged" });
    await tx.insert(s.memberships).values([
      { projectId, userId: petr, role: "owner" },
      { projectId, userId: aiko, role: "editor" },
      { projectId, userId: mika, role: "editor" },
      { projectId, userId: jonas, role: "editor" },
    ]);

    const cats = await tx
      .insert(s.categories)
      .values(["Plans", "Sights", "Tokyo"].map((name) => ({ projectId, name, createdBy: "bot" as const })))
      .returning();
    const cat = Object.fromEntries(cats.map((c) => [c.name, c.id])) as Record<"Plans" | "Sights" | "Tokyo", string>;

    const entry = async (values: Omit<typeof s.entries.$inferInsert, "projectId">, category: keyof typeof cat) => {
      const [row] = await tx
        .insert(s.entries)
        .values({ projectId, ...values })
        .returning();
      if (!row) throw new Error("insert failed");
      await tx.insert(s.entryCategories).values({ entryId: row.id, categoryId: cat[category], assignedBy: "bot" });
      return row;
    };

    // Yesterday
    await entry(
      {
        authorId: aiko,
        kind: "note",
        body: "Starting a pile for the trip. Drop anything you find, we'll plan the days by Friday.",
        createdAt: at(now, -1, 18, 2),
      },
      "Plans",
    );

    const sights = [
      { title: "Kinkaku-ji", area: "Kyoto · go early", image: "kinkakuji.jpg", url: "https://example.com/kinkaku-ji" },
      { title: "Kiyomizu-dera", area: "Kyoto · at sunset", image: "kiyomizu.jpg", url: "https://example.com/kiyomizu-dera" },
      { title: "Osaka Castle", area: "Day trip from Kyoto", image: "osaka-castle.jpg", url: "https://example.com/osaka-castle" },
    ];
    for (const [i, sight] of sights.entries()) {
      const row = await entry(
        { authorId: mika, kind: "link", groupKey: "seed-mika-sights", createdAt: at(now, -1, 18, 40 + i) },
        "Sights",
      );
      await tx.insert(s.linkPreviews).values({
        entryId: row.id,
        url: sight.url,
        title: sight.title,
        imageKey: `seed/${sight.image}`,
        placeMeta: { type: "sight", area: sight.area },
      });
    }

    await entry(
      {
        authorId: null,
        kind: "bot",
        body: "Kinkaku-ji is in northwest Kyoto and Kiyomizu-dera is in the east, so they fit better on different days. Want me to suggest a pairing for each day?",
        createdAt: at(now, -1, 18, 45),
      },
      "Plans",
    );

    // Today
    const capture = await entry(
      { authorId: jonas, kind: "capture", source: "extension", createdAt: at(now, 0, 9, 12) },
      "Tokyo",
    );
    await tx.insert(s.captures).values({
      entryId: capture.id,
      pageUrl: "https://example.com/tokyo-tower-guide",
      pageTitle: "A Tokyo Tower guide",
      selector: "main article figure:nth-of-type(1) img",
      relX: 0.42,
      relY: 0.31,
      scrollY: 1240,
      viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
    });
    await tx.insert(s.entryMedia).values({
      entryId: capture.id,
      storageKey: "seed/tokyo-fuji.jpg",
      role: "screenshot",
      width: 1440,
      height: 900,
    });
    const [pin1, pin2] = await tx
      .insert(s.pins)
      .values([
        { captureEntryId: capture.id, number: 1, x: 0.42, y: 0.31 },
        { captureEntryId: capture.id, number: 2, x: 0.7, y: 0.18 },
      ])
      .returning();
    if (!pin1 || !pin2) throw new Error("insert failed");
    await tx.insert(s.comments).values([
      {
        entryId: capture.id,
        pinId: pin1.id,
        authorId: jonas,
        body: "The tower view with Fuji behind it. Go at sunset?",
        createdAt: at(now, 0, 9, 12),
      },
      {
        entryId: capture.id,
        pinId: pin2.id,
        authorId: jonas,
        body: "Fuji only shows on clear days, so keep this flexible.",
        createdAt: at(now, 0, 9, 12),
      },
    ]);

    await entry(
      {
        authorId: mika,
        kind: "note",
        source: "telegram",
        replyToId: capture.id,
        body: "Yes! Let's make it our first evening in Tokyo.",
        createdAt: at(now, 0, 9, 30),
      },
      "Tokyo",
    );

    const ask = await entry(
      {
        authorId: aiko,
        kind: "note",
        body: "@kasa what else is near Kiyomizu-dera for the same evening?",
        createdAt: at(now, 0, 10, 5),
      },
      "Sights",
    );

    const answer = await entry(
      {
        authorId: null,
        kind: "bot",
        replyToId: ask.id,
        body: "Walk down through Higashiyama afterwards. Sannenzaka and Ninenzaka are the old stone lanes just below the temple.",
        createdAt: new Date(at(now, 0, 10, 5).getTime() + 20_000),
      },
      "Sights",
    );
    await tx.insert(s.linkPreviews).values({
      entryId: answer.id,
      url: "https://example.com/higashiyama",
      title: "Higashiyama lanes",
      imageKey: "seed/higashiyama.jpg",
      placeMeta: { type: "sight", area: "Kyoto · a short walk from Kiyomizu-dera" },
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { db, close } = createDb(requireDatabaseUrl(), { max: 1 });
  try {
    await seed(db);
    console.log("seeded Japan 2027");
  } finally {
    await close();
  }
}
