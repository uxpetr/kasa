// Data for the projects screen (P-02): each project with its members, last entry,
// unread count, and latest image. Only projects the user belongs to are read.
import { and, asc, count, desc, eq, inArray, isNull, ne, or, schema, sql, type Database } from "@kasa/db";
import type { Storage } from "@kasa/media";
import { previewLine } from "./preview";
import { listProjects, type ProjectSummary } from "./projects";

export interface PileMember {
  id: string;
  name: string;
}

export interface Pile extends ProjectSummary {
  members: PileMember[];
  /** The last entry worded for the card (D-145), or null for an empty project. */
  preview: string | null;
  /** Signed URL of the last entry's image, if it has one. */
  peekUrl: string | null;
  unread: number;
  entryCount: number;
  /** The last entry's time, or when the project was created. */
  activeAt: Date;
}

export async function listPiles(deps: { db: Database; storage: Pick<Storage, "presignDownload"> }, userId: string): Promise<Pile[]> {
  const { db } = deps;
  const projects = await listProjects(db, userId);
  if (projects.length === 0) return [];
  const ids = projects.map((p) => p.id);

  const [members, lastEntries, unread, entryCounts] = await Promise.all([
    db
      .select({ projectId: schema.memberships.projectId, id: schema.users.id, name: schema.users.name })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(inArray(schema.memberships.projectId, ids))
      .orderBy(asc(schema.memberships.joinedAt), asc(schema.users.id)),
    db
      .selectDistinctOn([schema.entries.projectId], {
        id: schema.entries.id,
        projectId: schema.entries.projectId,
        kind: schema.entries.kind,
        body: schema.entries.body,
        authorId: schema.entries.authorId,
        authorName: schema.users.name,
        createdAt: schema.entries.createdAt,
      })
      .from(schema.entries)
      .leftJoin(schema.users, eq(schema.users.id, schema.entries.authorId))
      .where(and(inArray(schema.entries.projectId, ids), isNull(schema.entries.deletedAt)))
      .orderBy(schema.entries.projectId, desc(schema.entries.createdAt), desc(schema.entries.id)),
    // Entries by others (the bot included) since the member last read the feed, or since joining.
    db
      .select({ projectId: schema.entries.projectId, n: count() })
      .from(schema.entries)
      .innerJoin(
        schema.memberships,
        and(eq(schema.memberships.projectId, schema.entries.projectId), eq(schema.memberships.userId, userId)),
      )
      .where(
        and(
          inArray(schema.entries.projectId, ids),
          isNull(schema.entries.deletedAt),
          or(isNull(schema.entries.authorId), ne(schema.entries.authorId, userId)),
          sql`${schema.entries.createdAt} > coalesce(${schema.memberships.lastReadAt}, ${schema.memberships.joinedAt})`,
        ),
      )
      .groupBy(schema.entries.projectId),
    db
      .select({ projectId: schema.entries.projectId, n: count() })
      .from(schema.entries)
      .where(and(inArray(schema.entries.projectId, ids), isNull(schema.entries.deletedAt)))
      .groupBy(schema.entries.projectId),
  ]);

  // Details for the last entries only: link title, capture page, and an image.
  const lastIds = lastEntries.map((e) => e.id);
  const [links, captures, media] = lastIds.length
    ? await Promise.all([
        db
          .select({ entryId: schema.linkPreviews.entryId, title: schema.linkPreviews.title, imageKey: schema.linkPreviews.imageKey })
          .from(schema.linkPreviews)
          .where(inArray(schema.linkPreviews.entryId, lastIds)),
        db
          .select({ entryId: schema.captures.entryId, pageUrl: schema.captures.pageUrl })
          .from(schema.captures)
          .where(inArray(schema.captures.entryId, lastIds)),
        db
          .select({ entryId: schema.entryMedia.entryId, key: schema.entryMedia.storageKey })
          .from(schema.entryMedia)
          .where(and(inArray(schema.entryMedia.entryId, lastIds), inArray(schema.entryMedia.role, ["photo", "screenshot"])))
          .orderBy(asc(schema.entryMedia.position)),
      ])
    : [[], [], []];

  const membersOf = new Map<string, PileMember[]>();
  for (const { projectId, id, name } of members) membersOf.set(projectId, [...(membersOf.get(projectId) ?? []), { id, name }]);
  const lastOf = new Map(lastEntries.map((e) => [e.projectId, e]));
  const unreadOf = new Map(unread.map((r) => [r.projectId, Number(r.n)]));
  const countOf = new Map(entryCounts.map((r) => [r.projectId, Number(r.n)]));
  const linkOf = new Map(links.map((l) => [l.entryId, l]));
  const pageOf = new Map(captures.map((c) => [c.entryId, c.pageUrl]));
  const mediaOf = new Map<string, string>();
  for (const m of media) if (!mediaOf.has(m.entryId)) mediaOf.set(m.entryId, m.key);

  const piles = await Promise.all(
    projects.map(async (p): Promise<Pile> => {
      const last = lastOf.get(p.id);
      const link = last ? linkOf.get(last.id) : undefined;
      const imageKey = last ? (mediaOf.get(last.id) ?? link?.imageKey ?? null) : null;
      return {
        ...p,
        members: membersOf.get(p.id) ?? [],
        preview: last
          ? previewLine({ ...last, linkTitle: link?.title ?? null, pageUrl: pageOf.get(last.id) ?? null }, userId)
          : null,
        peekUrl: imageKey ? await deps.storage.presignDownload(imageKey) : null,
        unread: unreadOf.get(p.id) ?? 0,
        entryCount: countOf.get(p.id) ?? 0,
        activeAt: last?.createdAt ?? p.createdAt,
      };
    }),
  );
  // Most recent activity first, like the prototype.
  return piles.sort((a, b) => b.activeAt.getTime() - a.activeAt.getTime());
}
