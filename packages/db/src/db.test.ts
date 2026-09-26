import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNull, lt, or } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "./client";
import { runMigrations } from "./migrate";
import * as s from "./schema";
import { SEED, seed } from "./seed";

// Runs against a throwaway database next to DATABASE_URL, so local data is never touched.
const baseUrl = process.env.DATABASE_URL;

describe.skipIf(!baseUrl)("database", () => {
  const dbName = `kasa_test_${randomBytes(4).toString("hex")}`;
  let admin: postgres.Sql;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    admin = postgres(baseUrl!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database ${dbName}`);
    const url = new URL(baseUrl!);
    url.pathname = `/${dbName}`;
    await runMigrations(url.toString());
    ({ db, close } = createDb(url.toString(), { max: 2 }));
    await seed(db, new Date("2026-09-26T12:00:00"));
  });

  afterAll(async () => {
    await close?.();
    await admin?.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin?.end();
  });

  it("creates every table in the v0 data model", async () => {
    const tables = await db.execute<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    expect(tables.map((t) => t.table_name).sort()).toEqual(
      [
        "captures", "categories", "comments", "entries", "entry_categories", "entry_media",
        "invites", "link_previews", "memberships", "pins", "project_passes", "projects",
        "reactions", "subscriptions", "telegram_identities", "telegram_links",
        "telegram_messages", "users",
      ].sort(),
    );
  });

  it("seeds Japan 2027 with four members and one owner", async () => {
    const members = await db.select().from(s.memberships).where(eq(s.memberships.projectId, SEED.projectId));
    expect(members).toHaveLength(4);
    expect(members.filter((m) => m.role === "owner").map((m) => m.userId)).toEqual([SEED.users.petr]);
  });

  it("seeds notes, place links with images, a capture with pins, and bot replies", async () => {
    const feed = await db
      .select()
      .from(s.entries)
      .where(eq(s.entries.projectId, SEED.projectId))
      .orderBy(asc(s.entries.createdAt));
    expect(feed.map((e) => e.kind)).toEqual(["note", "link", "link", "link", "bot", "capture", "note", "note", "bot"]);
    expect(feed.filter((e) => e.kind === "bot").every((e) => e.authorId === null)).toBe(true);

    const capture = feed.find((e) => e.kind === "capture")!;
    const [anchor] = await db.select().from(s.captures).where(eq(s.captures.entryId, capture.id));
    expect(anchor).toMatchObject({ pageUrl: expect.any(String), selector: expect.any(String), scrollY: expect.any(Number) });
    const pinRows = await db.select().from(s.pins).where(eq(s.pins.captureEntryId, capture.id));
    expect(pinRows.map((p) => p.number).sort()).toEqual([1, 2]);

    const telegramReply = feed.find((e) => e.source === "telegram")!;
    expect(telegramReply.replyToId).toBe(capture.id);

    const previews = await db.select().from(s.linkPreviews);
    expect(previews.every((p) => p.imageKey?.startsWith("seed/"))).toBe(true);
  });

  it("keeps seed timestamps in the past", async () => {
    const now = new Date("2026-09-26T08:00:00");
    await seed(db, now);
    const feed = await db.select().from(s.entries).where(eq(s.entries.projectId, SEED.projectId));
    expect(feed.every((e) => e.createdAt <= now)).toBe(true);
  });

  it("re-seeding replaces the demo instead of duplicating it", async () => {
    await seed(db);
    await seed(db);
    expect(await db.$count(s.entries, eq(s.entries.projectId, SEED.projectId))).toBe(9);
    expect(await db.$count(s.users)).toBe(4);
  });

  it("pages the feed newest first with a (created_at, id) cursor", async () => {
    const page = (cursor?: { createdAt: Date; id: string }) =>
      db
        .select({ id: s.entries.id, createdAt: s.entries.createdAt })
        .from(s.entries)
        .where(
          and(
            eq(s.entries.projectId, SEED.projectId),
            isNull(s.entries.deletedAt),
            cursor
              ? or(
                  lt(s.entries.createdAt, cursor.createdAt),
                  and(eq(s.entries.createdAt, cursor.createdAt), lt(s.entries.id, cursor.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(s.entries.createdAt), desc(s.entries.id))
        .limit(4);

    const seen: string[] = [];
    let cursor: { createdAt: Date; id: string } | undefined;
    for (;;) {
      const rows = await page(cursor);
      seen.push(...rows.map((r) => r.id));
      if (rows.length < 4) break;
      cursor = rows.at(-1);
    }
    expect(seen).toHaveLength(9);
    expect(new Set(seen).size).toBe(9);
  });

  it("indexes the feed by (project_id, created_at, id)", async () => {
    const [index] = await db.execute<{ indexdef: string }>(
      "select indexdef from pg_indexes where indexname = 'entries_feed_idx'",
    );
    expect(index?.indexdef).toContain("(project_id, created_at, id)");
  });

  it("uses the feed index for a newest-first page", async () => {
    // The demo table is tiny, so steer the planner away from scans it would prefer at this size.
    const plan = await db.transaction(async (tx) => {
      await tx.execute("set local enable_seqscan = off");
      await tx.execute("set local enable_bitmapscan = off");
      return tx.execute<{ "QUERY PLAN": string }>(
        `explain select id from entries where project_id = '${SEED.projectId}' order by created_at desc, id desc limit 50`,
      );
    });
    const text = plan.map((r) => r["QUERY PLAN"]).join("\n");
    expect(text).toMatch(/Index (Only )?Scan Backward using entries_feed_idx/);
    expect(text).not.toContain("Sort");
  });

  it("deleting a project removes its entries", async () => {
    await db.delete(s.projects).where(eq(s.projects.id, SEED.projectId));
    expect(await db.$count(s.entries)).toBe(0);
    expect(await db.$count(s.users)).toBe(4);
  });
});
