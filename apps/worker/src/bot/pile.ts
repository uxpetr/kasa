// What Kasa Bot may read to answer (P-17): one pile, and only through this file.
// Every query here is filtered by that pile's id, so an answer can't draw on another pile's
// entries, members, or media, whatever the question says (CLAUDE.md hard rule). Media is never
// read at all: the bot sees captions and titles, not images or storage keys.
import { and, asc, desc, eq, inArray, isNull, schema, type Database } from "@kasa/db";
import { BOT_MAX_CONTEXT_ENTRIES, SORTABLE_KINDS } from "@kasa/shared";

/** How much of a pile goes to the model: the newest entries, oldest first. */
export const MAX_CONTEXT_ENTRIES = BOT_MAX_CONTEXT_ENTRIES;
export const MAX_CONTEXT_CHARS = 40_000;

export interface PileEntry {
  ref: number;
  at: Date;
  author: string;
  kind: string;
  text: string;
  replyTo?: number;
}

export interface Pile {
  name: string;
  members: string[];
  entries: PileEntry[];
}

interface Place {
  type?: string;
  area?: string;
}

/** Reads one pile for Kasa Bot. Null if the pile is gone. */
export async function readPile(db: Database, projectId: string): Promise<Pile | null> {
  const [project] = await db
    .select({ name: schema.projects.name })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), isNull(schema.projects.deletedAt)));
  if (!project) return null;

  const members = await db
    .select({ name: schema.users.name })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.projectId, projectId))
    .orderBy(asc(schema.users.name));

  // Finished entries only: pending or failed bot cards and deleted entries say nothing.
  const rows = (
    await db
      .select({
        id: schema.entries.id,
        kind: schema.entries.kind,
        botCard: schema.entries.botCard,
        replyToId: schema.entries.replyToId,
        createdAt: schema.entries.createdAt,
        author: schema.users.name,
      })
      .from(schema.entries)
      .leftJoin(schema.users, eq(schema.users.id, schema.entries.authorId))
      .where(and(eq(schema.entries.projectId, projectId), isNull(schema.entries.deletedAt)))
      .orderBy(desc(schema.entries.createdAt), desc(schema.entries.id))
      .limit(MAX_CONTEXT_ENTRIES)
  )
    .filter((r) => r.kind !== "bot" || r.botCard === null)
    .reverse();
  const texts = await describe(db, projectId, rows.map((r) => r.id));
  const refs = new Map(rows.map((r, i) => [r.id, i + 1]));
  const entries = rows.map((r): PileEntry => {
    const replyTo = r.replyToId ? refs.get(r.replyToId) : undefined;
    return {
      ref: refs.get(r.id)!,
      at: r.createdAt,
      author: r.kind === "bot" ? "Kasa Bot" : (r.author ?? "Someone who left"),
      kind: r.kind,
      text: texts.get(r.id) ?? "",
      ...(replyTo ? { replyTo } : {}),
    };
  });
  return { name: project.name, members: members.map((m) => m.name), entries };
}

/** The pile as text for the model, newest entries kept when it's too long. */
export function formatPile(pile: Pile): string {
  const lines = pile.entries.map(
    (e) => `#${e.ref} ${e.at.toISOString().slice(0, 16).replace("T", " ")} ${e.author} (${e.kind})${e.replyTo ? ` replying to #${e.replyTo}` : ""}: ${e.text}`,
  );
  let kept = lines;
  while (kept.join("\n").length > MAX_CONTEXT_CHARS && kept.length > 1) kept = kept.slice(1);
  return [`Pile: ${pile.name}`, `Members: ${pile.members.join(", ")}`, "", ...kept].join("\n");
}

/**
 * What each entry says, for the model: link and capture titles, the body, and comments.
 * Only entries of `projectId` are described, whatever ids are passed.
 */
async function describe(db: Database, projectId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const [rows, links, captures, comments] = await Promise.all([
    db
      .select({ id: schema.entries.id, body: schema.entries.body })
      .from(schema.entries)
      .where(and(eq(schema.entries.projectId, projectId), inArray(schema.entries.id, ids))),
    db
      .select({ entryId: schema.linkPreviews.entryId, url: schema.linkPreviews.url, title: schema.linkPreviews.title, siteName: schema.linkPreviews.siteName, placeMeta: schema.linkPreviews.placeMeta })
      .from(schema.linkPreviews)
      .innerJoin(schema.entries, eq(schema.entries.id, schema.linkPreviews.entryId))
      .where(and(eq(schema.entries.projectId, projectId), inArray(schema.linkPreviews.entryId, ids))),
    db
      .select({ entryId: schema.captures.entryId, pageUrl: schema.captures.pageUrl, pageTitle: schema.captures.pageTitle })
      .from(schema.captures)
      .innerJoin(schema.entries, eq(schema.entries.id, schema.captures.entryId))
      .where(and(eq(schema.entries.projectId, projectId), inArray(schema.captures.entryId, ids))),
    db
      .select({ entryId: schema.comments.entryId, body: schema.comments.body, author: schema.users.name })
      .from(schema.comments)
      .innerJoin(schema.entries, eq(schema.entries.id, schema.comments.entryId))
      .leftJoin(schema.users, eq(schema.users.id, schema.comments.authorId))
      .where(and(eq(schema.entries.projectId, projectId), inArray(schema.comments.entryId, ids)))
      .orderBy(asc(schema.comments.createdAt)),
  ]);
  const linkBy = new Map(links.map((l) => [l.entryId, l]));
  const captureBy = new Map(captures.map((c) => [c.entryId, c]));
  return new Map(
    rows.map((r) => {
      const parts: string[] = [];
      const link = linkBy.get(r.id);
      if (link) {
        const place = (link.placeMeta ?? {}) as Place;
        parts.push([link.title, link.siteName, link.url].filter(Boolean).join(" · "));
        if (place.type || place.area) parts.push(`(${[place.type, place.area].filter(Boolean).join(", ")})`);
      }
      const capture = captureBy.get(r.id);
      if (capture) parts.push(`Capture of ${[capture.pageTitle, capture.pageUrl].filter(Boolean).join(" · ")}`);
      if (r.body) parts.push(r.body);
      for (const c of comments.filter((c) => c.entryId === r.id)) parts.push(`${c.author ?? "Someone"} commented: ${c.body}`);
      return [r.id, parts.join(" ")];
    }),
  );
}

// Sorting (P-19): the same one-pile rule. Every query below is filtered by the pile's id.

export interface SortItem {
  id: string;
  ref: number;
  kind: string;
  author: string;
  text: string;
}

const sortable = (projectId: string) =>
  and(
    eq(schema.entries.projectId, projectId),
    isNull(schema.entries.deletedAt),
    isNull(schema.entries.replyToId),
    inArray(schema.entries.kind, [...SORTABLE_KINDS]),
  );

/** People's posts in this pile that Kasa Bot hasn't sorted yet, oldest first. */
export async function readUnsorted(db: Database, projectId: string, limit: number): Promise<SortItem[]> {
  const rows = await db
    .select({ id: schema.entries.id, kind: schema.entries.kind, author: schema.users.name })
    .from(schema.entries)
    .leftJoin(schema.users, eq(schema.users.id, schema.entries.authorId))
    .where(and(sortable(projectId), isNull(schema.entries.sortedAt)))
    .orderBy(asc(schema.entries.createdAt), asc(schema.entries.id))
    .limit(limit);
  const texts = await describe(db, projectId, rows.map((r) => r.id));
  return rows.map((r, i) => ({ id: r.id, ref: i + 1, kind: r.kind, author: r.author ?? "Someone who left", text: texts.get(r.id) ?? "" }));
}

/** This pile's categories, in the order they were made. */
export async function readCategories(db: Database, projectId: string): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: schema.categories.id, name: schema.categories.name })
    .from(schema.categories)
    .where(eq(schema.categories.projectId, projectId))
    .orderBy(asc(schema.categories.createdAt), asc(schema.categories.name));
}

/** Members' own choices in this pile, newest first, so the bot learns from fixes. */
export async function readFixes(db: Database, projectId: string, limit = 20): Promise<{ text: string; category: string }[]> {
  const rows = await db
    .select({ entryId: schema.entryCategories.entryId, category: schema.categories.name })
    .from(schema.entryCategories)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.entryCategories.categoryId))
    .innerJoin(schema.entries, eq(schema.entries.id, schema.entryCategories.entryId))
    .where(and(eq(schema.categories.projectId, projectId), sortable(projectId), eq(schema.entryCategories.assignedBy, "user")))
    .orderBy(desc(schema.entryCategories.createdAt))
    .limit(limit);
  const texts = await describe(db, projectId, [...new Set(rows.map((r) => r.entryId))]);
  return rows.map((r) => ({ text: texts.get(r.entryId) ?? "", category: r.category })).filter((f) => f.text);
}
