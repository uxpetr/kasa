// The zen chat feed (P-03): reading pages, posting, and marking read.
// Access: members read (viewers included); owners and editors post unless archived (lib/access).
import { and, asc, desc, eq, inArray, isNull, lt, or, schema, sql, type Database } from "@kasa/db";
import { track } from "@kasa/shared";
import { canAdd, canRead, projectAccess } from "./access";
import { fail, isUuid, ok, type Result } from "./result";

export const PAGE_SIZE = 30;
export const MAX_ENTRY_TEXT = 4000;
export const MAX_PHOTOS_PER_ENTRY = 10;

type EntryKind = (typeof schema.entryKind.enumValues)[number];

export interface FeedEntry {
  id: string;
  kind: EntryKind;
  body: string | null;
  createdAt: string;
  author: { id: string; name: string } | null;
  /** Processed images, in order; served through /api/media/<uploadId>/<variant>. */
  photos: { uploadId: string; width: number | null; height: number | null }[];
  link: { url: string; title: string | null; siteName: string | null } | null;
  capture: { pageUrl: string; pageTitle: string | null } | null;
}

export interface FeedPage {
  /** Oldest first, ready to render top to bottom (D-005). */
  entries: FeedEntry[];
  /** Pass as `before` to load the next older page; null at the start of the project. */
  nextCursor: string | null;
}

// Cursor = "<ISO time>_<entry id>" of the oldest entry on the page; the id breaks ties (D-005).
function parseCursor(cursor: unknown): { at: Date; id: string } | null | "invalid" {
  if (cursor === undefined || cursor === null || cursor === "") return null;
  if (typeof cursor !== "string") return "invalid";
  const [iso, id] = cursor.split("_");
  const at = new Date(iso ?? "");
  return Number.isNaN(at.getTime()) || !isUuid(id) ? "invalid" : { at, id };
}

const toCursor = (e: { createdAt: Date; id: string }) => `${e.createdAt.toISOString()}_${e.id}`;

/** A page of the feed, newest page first; `before` pages back through history. */
export async function listEntries(
  db: Database,
  userId: string,
  projectId: string,
  options: { before?: unknown; limit?: number } = {},
): Promise<Result<FeedPage>> {
  const access = isUuid(projectId) ? await projectAccess(db, userId, projectId) : null;
  if (!canRead(access)) return fail(404, "Project not found");
  const cursor = parseCursor(options.before);
  if (cursor === "invalid") return fail(400, "Invalid cursor");
  const limit = Math.min(Math.max(options.limit ?? PAGE_SIZE, 1), 100);

  const rows = await db
    .select({
      id: schema.entries.id,
      kind: schema.entries.kind,
      body: schema.entries.body,
      createdAt: schema.entries.createdAt,
      authorId: schema.entries.authorId,
      authorName: schema.users.name,
    })
    .from(schema.entries)
    .leftJoin(schema.users, eq(schema.users.id, schema.entries.authorId))
    .where(
      and(
        eq(schema.entries.projectId, projectId),
        isNull(schema.entries.deletedAt),
        cursor
          ? or(
              lt(schema.entries.createdAt, cursor.at),
              and(eq(schema.entries.createdAt, cursor.at), lt(schema.entries.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(schema.entries.createdAt), desc(schema.entries.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const entries = await withDetails(db, page);
  return ok({
    entries: entries.reverse(),
    nextCursor: rows.length > limit ? toCursor(page[page.length - 1]!) : null,
  });
}

type Row = { id: string; kind: EntryKind; body: string | null; createdAt: Date; authorId: string | null; authorName: string | null };

async function withDetails(db: Database, rows: Row[]): Promise<FeedEntry[]> {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  const [media, links, captures] = await Promise.all([
    db
      .select({
        entryId: schema.entryMedia.entryId,
        uploadId: schema.entryMedia.uploadId,
        width: schema.entryMedia.width,
        height: schema.entryMedia.height,
      })
      .from(schema.entryMedia)
      .where(and(inArray(schema.entryMedia.entryId, ids), eq(schema.entryMedia.role, "photo")))
      .orderBy(asc(schema.entryMedia.position)),
    db
      .select({ entryId: schema.linkPreviews.entryId, url: schema.linkPreviews.url, title: schema.linkPreviews.title, siteName: schema.linkPreviews.siteName })
      .from(schema.linkPreviews)
      .where(inArray(schema.linkPreviews.entryId, ids)),
    db
      .select({ entryId: schema.captures.entryId, pageUrl: schema.captures.pageUrl, pageTitle: schema.captures.pageTitle })
      .from(schema.captures)
      .where(inArray(schema.captures.entryId, ids)),
  ]);
  const photosOf = new Map<string, FeedEntry["photos"]>();
  for (const m of media) {
    if (!m.uploadId) continue;
    photosOf.set(m.entryId, [...(photosOf.get(m.entryId) ?? []), { uploadId: m.uploadId, width: m.width, height: m.height }]);
  }
  const linkOf = new Map(links.map(({ entryId, ...l }) => [entryId, l]));
  const captureOf = new Map(captures.map(({ entryId, ...c }) => [entryId, c]));

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
    author: r.authorId ? { id: r.authorId, name: r.authorName ?? "" } : null,
    photos: photosOf.get(r.id) ?? [],
    link: linkOf.get(r.id) ?? null,
    capture: captureOf.get(r.id) ?? null,
  }));
}

/** A whole message that is one http(s) URL, or null (D-149). */
export function soleUrl(text: string): string | null {
  if (!/^https?:\/\/\S+$/i.test(text)) return null;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Posts from the app composer: images make one Photo entry with the text as caption (D-150);
 * a lone URL makes a Link entry (D-149); anything else is a Note.
 */
export async function createEntry(
  db: Database,
  userId: string,
  projectId: string,
  input: { text?: unknown; uploadIds?: unknown },
): Promise<Result<FeedEntry>> {
  const access = isUuid(projectId) ? await projectAccess(db, userId, projectId) : null;
  if (!access) return fail(404, "Project not found");
  if (!canAdd(access)) return fail(403, access.archived ? "Project is archived" : "Viewers can't add to this project");

  if (input.text !== undefined && typeof input.text !== "string") return fail(400, "text must be a string");
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (text.length > MAX_ENTRY_TEXT) return fail(400, `text must be at most ${MAX_ENTRY_TEXT} characters`);

  const uploadIds = input.uploadIds ?? [];
  if (!Array.isArray(uploadIds) || !uploadIds.every(isUuid)) return fail(400, "uploadIds must be a list of ids");
  if (new Set(uploadIds).size !== uploadIds.length) return fail(400, "uploadIds must not repeat");
  if (uploadIds.length > MAX_PHOTOS_PER_ENTRY) return fail(400, `At most ${MAX_PHOTOS_PER_ENTRY} photos per message`);
  if (!text && uploadIds.length === 0) return fail(400, "Write something or attach a photo");

  // Only the uploader's own, processed images from this project, each used once.
  const uploads = uploadIds.length
    ? await db
        .select({
          id: schema.uploads.id,
          fullKey: schema.uploads.fullKey,
          width: schema.uploads.width,
          height: schema.uploads.height,
        })
        .from(schema.uploads)
        .where(
          and(
            inArray(schema.uploads.id, uploadIds),
            eq(schema.uploads.uploaderId, userId),
            eq(schema.uploads.projectId, projectId),
            eq(schema.uploads.status, "ready"),
          ),
        )
    : [];
  const used = uploadIds.length
    ? await db.select({ id: schema.entryMedia.uploadId }).from(schema.entryMedia).where(inArray(schema.entryMedia.uploadId, uploadIds))
    : [];
  if (uploads.length !== uploadIds.length || used.length > 0 || uploads.some((u) => !u.fullKey)) {
    return fail(409, "Some photos aren't ready or can't be used");
  }
  const byId = new Map(uploads.map((u) => [u.id, u]));

  const url = uploadIds.length === 0 ? soleUrl(text) : null;
  const kind: EntryKind = uploadIds.length ? "photo" : url ? "link" : "note";

  const entryId = await db
    .transaction(async (tx) => {
    const [entry] = await tx
      .insert(schema.entries)
      .values({ projectId, authorId: userId, kind, body: kind === "link" ? null : text || null, source: "app" })
      .returning({ id: schema.entries.id });
    if (kind === "photo") {
      await tx.insert(schema.entryMedia).values(
        uploadIds.map((id, position) => {
          const u = byId.get(id)!;
          return { entryId: entry!.id, uploadId: id, storageKey: u.fullKey!, width: u.width, height: u.height, role: "photo" as const, position };
        }),
      );
    }
    if (kind === "link") await tx.insert(schema.linkPreviews).values({ entryId: entry!.id, url: url! });
    return entry!.id;
    })
    // Two sends racing with the same image: the unique index lets only one through.
    .catch((error: unknown) => {
      if (isUniqueViolation(error)) return null;
      throw error;
    });
  if (!entryId) return fail(409, "Some photos aren't ready or can't be used");

  await track("entry_created", userId, { projectId, kind, source: "app" });
  const [row] = await db
    .select({
      id: schema.entries.id,
      kind: schema.entries.kind,
      body: schema.entries.body,
      createdAt: schema.entries.createdAt,
      authorId: schema.entries.authorId,
      authorName: schema.users.name,
    })
    .from(schema.entries)
    .leftJoin(schema.users, eq(schema.users.id, schema.entries.authorId))
    .where(eq(schema.entries.id, entryId));
  return ok((await withDetails(db, [row!]))[0]!);
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** Opening the feed marks everything read (D-147); never moves backwards. */
export async function markRead(db: Database, userId: string, projectId: string): Promise<Result<{ ok: true }>> {
  if (!isUuid(projectId)) return fail(404, "Project not found");
  const rows = await db
    .update(schema.memberships)
    .set({ lastReadAt: sql`greatest(coalesce(${schema.memberships.lastReadAt}, 'epoch'::timestamptz), now())` })
    .where(and(eq(schema.memberships.projectId, projectId), eq(schema.memberships.userId, userId)))
    .returning({ projectId: schema.memberships.projectId });
  return rows.length ? ok({ ok: true }) : fail(404, "Project not found");
}

/** The uploader's view of an upload's progress, for the composer to wait on. */
export async function uploadStatus(
  db: Database,
  userId: string,
  uploadId: string,
): Promise<Result<{ status: (typeof schema.uploadStatus.enumValues)[number] }>> {
  if (!isUuid(uploadId)) return fail(404, "Upload not found");
  const [row] = await db
    .select({ status: schema.uploads.status })
    .from(schema.uploads)
    .where(and(eq(schema.uploads.id, uploadId), eq(schema.uploads.uploaderId, userId)));
  return row ? ok(row) : fail(404, "Upload not found");
}
