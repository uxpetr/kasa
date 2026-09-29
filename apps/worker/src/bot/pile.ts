// What Kasa Bot may read to answer (P-17): one pile, and only through this file.
// Every query here is filtered by that pile's id, so an answer can't draw on another pile's
// entries, members, or media, whatever the question says (CLAUDE.md hard rule). Media is never
// read at all: the bot sees captions and titles, not images or storage keys.
import { and, asc, desc, eq, inArray, isNull, schema, type Database } from "@kasa/db";

/** How much of a pile goes to the model: the newest entries, oldest first. */
export const MAX_CONTEXT_ENTRIES = 200;
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
        body: schema.entries.body,
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
  const ids = rows.map((r) => r.id);

  const links = ids.length
    ? await db
        .select({ entryId: schema.linkPreviews.entryId, url: schema.linkPreviews.url, title: schema.linkPreviews.title, siteName: schema.linkPreviews.siteName, placeMeta: schema.linkPreviews.placeMeta })
        .from(schema.linkPreviews)
        .innerJoin(schema.entries, eq(schema.entries.id, schema.linkPreviews.entryId))
        .where(and(eq(schema.entries.projectId, projectId), inArray(schema.linkPreviews.entryId, ids)))
    : [];
  const captures = ids.length
    ? await db
        .select({ entryId: schema.captures.entryId, pageUrl: schema.captures.pageUrl, pageTitle: schema.captures.pageTitle })
        .from(schema.captures)
        .innerJoin(schema.entries, eq(schema.entries.id, schema.captures.entryId))
        .where(and(eq(schema.entries.projectId, projectId), inArray(schema.captures.entryId, ids)))
    : [];
  const comments = ids.length
    ? await db
        .select({ entryId: schema.comments.entryId, body: schema.comments.body, author: schema.users.name })
        .from(schema.comments)
        .innerJoin(schema.entries, eq(schema.entries.id, schema.comments.entryId))
        .leftJoin(schema.users, eq(schema.users.id, schema.comments.authorId))
        .where(and(eq(schema.entries.projectId, projectId), inArray(schema.comments.entryId, ids)))
        .orderBy(asc(schema.comments.createdAt))
    : [];

  const refs = new Map(rows.map((r, i) => [r.id, i + 1]));
  const linkBy = new Map(links.map((l) => [l.entryId, l]));
  const captureBy = new Map(captures.map((c) => [c.entryId, c]));
  const entries = rows.map((r): PileEntry => {
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
    const replyTo = r.replyToId ? refs.get(r.replyToId) : undefined;
    return {
      ref: refs.get(r.id)!,
      at: r.createdAt,
      author: r.kind === "bot" ? "Kasa Bot" : (r.author ?? "Someone who left"),
      kind: r.kind,
      text: parts.join(" "),
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
