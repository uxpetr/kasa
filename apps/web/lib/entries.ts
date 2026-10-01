// The zen chat feed (P-03, P-04): reading pages, posting, reacting, deleting, and marking read.
// Access: members read (viewers included); owners and editors post and react unless archived (lib/access).
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, ne, or, schema, sql, type Database } from "@kasa/db";
import { sendSort, type JobQueue } from "@kasa/jobs";
import { errorAttributes } from "@kasa/observability";
import { BOT_MAX_CONTEXT_ENTRIES, track } from "@kasa/shared";
import { canAdd, canDeleteEntry, canReact, canRead, projectAccess } from "./access";
import { categoriesOf, countPosts, listCategories, RECEIPT_CARDS, receiptsOf, type Category, type CategoryChipData, type ReceiptSummary } from "./categories";
import { log } from "./log";
import { tagsKasa } from "./mentions";
import { parseMentions, queueNotifications, recordNotifications } from "./notifications";
import { isReaction, REACTIONS, type Reaction } from "./reactions";
import { fail, isUuid, ok, type Result } from "./result";

export const PAGE_SIZE = 30;
export const MAX_ENTRY_TEXT = 4000;
export const MAX_PHOTOS_PER_ENTRY = 10;


type EntryKind = (typeof schema.entryKind.enumValues)[number];

export interface FeedEntry {
  id: string;
  kind: EntryKind;
  body: string | null;
  /** A Kasa Bot card with an action, e.g. "welcome" (D-180), or an answer's state (P-17). */
  botCard: string | null;
  /** How many entries a pending answer reads (D-199). */
  botEntriesRead: number | null;
  createdAt: string;
  author: { id: string; name: string } | null;
  /** A deleted entry keeps its kind and author for the outline, and nothing else (D-155). */
  deleted: boolean;
  /** Who deleted it, when known. */
  deletedBy: { id: string; name: string } | null;
  /** Processed images, in order; served through /api/media/<uploadId>/<variant>. */
  photos: { uploadId: string; width: number | null; height: number | null }[];
  /** `hasImage`: the preview image is served through /api/entries/<id>/preview-image. */
  link: { url: string; title: string | null; siteName: string | null; hasImage: boolean } | null;
  capture: {
    pageUrl: string;
    pageTitle: string | null;
    /** Served through /api/entries/<id>/media/<mediaId>. */
    screenshot: { mediaId: string; width: number | null; height: number | null } | null;
    pins: { number: number; x: number; y: number }[];
    /** The first comment on pin 1, shown on the print. */
    note: string | null;
  } | null;
  /** Only reactions someone has used, in picker order. */
  reactions: { emoji: Reaction; count: number; mine: boolean }[];
  /** What this entry replies to (D-006), shown as a small clipped print; its own replyTo is always null. */
  replyTo: FeedEntry | null;
  /** Its category stamps, in chip order (P-19). */
  categories: Category[];
  /** On a sorting receipt: what it lists (D-201). */
  receipt: ReceiptSummary | null;
  /** On a Kasa Bot answer: its recommendations from the web (P-20). */
  ideas: FeedIdea[];
  /** A link a member added from one of Kasa Bot's ideas: "from Kasa Bot" (D-204). */
  fromBot: boolean;
}

export interface FeedIdea {
  id: string;
  url: string;
  title: string;
  note: string | null;
  siteName: string | null;
  /** Served through /api/entries/<card id>/ideas/<id>/image. */
  hasImage: boolean;
  /** Once a member added it: the link, and the category it was filed into, if any. */
  added: { entryId: string; category: string | null } | null;
}

export interface FeedPage {
  /** Oldest first, ready to render top to bottom (D-005). */
  entries: FeedEntry[];
  /** Pass as `before` to load the next older page; null at the start of the project. */
  nextCursor: string | null;
  /** Database time before the read; pass as `since` to fetch what changed afterwards (P-06). */
  syncedAt: string;
  /** The pile's category chips (P-19), and its live posts for "All". */
  categories: CategoryChipData[];
  postCount: number;
}

export interface FeedChanges {
  /** Entries created or changed since `since`, oldest first; deleted ones as outlines. */
  entries: FeedEntry[];
  syncedAt: string;
  /** Too much changed to list; reload the newest page instead. */
  truncated: boolean;
  /** The pile's category chips now; they change without any entry changing, e.g. a rename. */
  categories: CategoryChipData[];
  postCount: number;
}

export const MAX_CHANGES = 100;
/**
 * `since` is moved back this much, so a change committed a moment after its
 * `updated_at` is never missed. Changes may repeat; clients replace entries by id.
 */
const CHANGES_OVERLAP_MS = 5_000;

async function dbNow(db: Database): Promise<string> {
  const [row] = await db.execute<{ now: Date | string }>(sql`select now() as now`);
  return new Date(row!.now).toISOString();
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

/**
 * A page of the feed, newest page first; `before` pages back through history. With `category`,
 * only the posts in that category and their replies (P-19).
 */
export async function listEntries(
  db: Database,
  userId: string,
  projectId: string,
  options: { before?: unknown; limit?: number; category?: unknown } = {},
): Promise<Result<FeedPage>> {
  const access = isUuid(projectId) ? await projectAccess(db, userId, projectId) : null;
  if (!canRead(access)) return fail(404, "Project not found");
  const cursor = parseCursor(options.before);
  if (cursor === "invalid") return fail(400, "Invalid cursor");
  if (options.category !== undefined && options.category !== null && !isUuid(options.category)) return fail(400, "Invalid category");
  const category = typeof options.category === "string" ? options.category : null;
  const inCategory = category
    ? sql`(select ${schema.entryCategories.entryId} from ${schema.entryCategories} join ${schema.categories} on ${schema.categories.id} = ${schema.entryCategories.categoryId} where ${schema.entryCategories.categoryId} = ${category} and ${schema.categories.projectId} = ${projectId})`
    : null;
  const limit = Math.min(Math.max(options.limit ?? PAGE_SIZE, 1), 100);
  const syncedAt = await dbNow(db);

  const rows = await db
    .select(rowColumns)
    .from(schema.entries)
    .leftJoin(schema.users, eq(schema.users.id, schema.entries.authorId))
    .where(
      and(
        eq(schema.entries.projectId, projectId),
        inCategory ? or(sql`${schema.entries.id} in ${inCategory}`, sql`${schema.entries.replyToId} in ${inCategory}`) : undefined,
        // Deleted entries stay in the feed as outlines (D-155).
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
  const [entries, categories, postCount] = await Promise.all([withDetails(db, page, userId), listCategories(db, projectId), countPosts(db, projectId)]);
  return ok({
    entries: entries.reverse(),
    nextCursor: rows.length > limit ? toCursor(page[page.length - 1]!) : null,
    syncedAt,
    categories,
    postCount,
  });
}

/** What changed in the project since `since` (P-06): new entries, reactions, comments, deletions. */
export async function listChanges(db: Database, userId: string, projectId: string, since: unknown): Promise<Result<FeedChanges>> {
  const access = isUuid(projectId) ? await projectAccess(db, userId, projectId) : null;
  if (!canRead(access)) return fail(404, "Project not found");
  const at = typeof since === "string" ? new Date(since) : new Date(NaN);
  if (Number.isNaN(at.getTime())) return fail(400, "since must be a time");
  const syncedAt = await dbNow(db);

  const rows = await db
    .select(rowColumns)
    .from(schema.entries)
    .leftJoin(schema.users, eq(schema.users.id, schema.entries.authorId))
    .where(and(eq(schema.entries.projectId, projectId), gt(schema.entries.updatedAt, new Date(at.getTime() - CHANGES_OVERLAP_MS))))
    .orderBy(asc(schema.entries.updatedAt))
    .limit(MAX_CHANGES + 1);
  const [categories, postCount] = await Promise.all([listCategories(db, projectId), countPosts(db, projectId)]);
  if (rows.length > MAX_CHANGES) return ok({ entries: [], syncedAt, truncated: true, categories, postCount });
  const entries = await withDetails(db, rows, userId);
  entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return ok({ entries, syncedAt, truncated: false, categories, postCount });
}

const rowColumns = {
  id: schema.entries.id,
  projectId: schema.entries.projectId,
  kind: schema.entries.kind,
  body: schema.entries.body,
  botCard: schema.entries.botCard,
  botEntriesRead: schema.entries.botEntriesRead,
  createdAt: schema.entries.createdAt,
  deletedAt: schema.entries.deletedAt,
  deletedById: schema.entries.deletedBy,
  deletedByName: sql<string | null>`(select ${schema.users.name} from ${schema.users} where ${schema.users.id} = ${schema.entries.deletedBy})`,
  authorId: schema.entries.authorId,
  authorName: schema.users.name,
  replyToId: schema.entries.replyToId,
  suggestedBy: schema.entries.suggestedBy,
};

type Row = {
  id: string;
  projectId: string;
  kind: EntryKind;
  body: string | null;
  botCard: string | null;
  botEntriesRead: number | null;
  createdAt: Date;
  deletedAt: Date | null;
  deletedById: string | null;
  deletedByName: string | null;
  authorId: string | null;
  authorName: string | null;
  replyToId: string | null;
  suggestedBy: string | null;
};

async function rowById(db: Database, entryId: string): Promise<Row | undefined> {
  const [row] = await db
    .select(rowColumns)
    .from(schema.entries)
    .leftJoin(schema.users, eq(schema.users.id, schema.entries.authorId))
    .where(eq(schema.entries.id, entryId));
  return row;
}

async function withDetails(db: Database, rows: Row[], viewerId: string, { quotes = true } = {}): Promise<FeedEntry[]> {
  // Nothing of a deleted entry's content leaves the server.
  const ids = rows.filter((r) => !r.deletedAt).map((r) => r.id);
  if (ids.length === 0) return rows.map((r) => toFeedEntry(r));
  const quoteOf = quotes ? await quotedEntries(db, rows, viewerId) : new Map<string, FeedEntry>();
  const receiptIds = rows.filter((r) => !r.deletedAt && r.kind === "bot" && r.botCard && RECEIPT_CARDS.includes(r.botCard)).map((r) => r.id);
  const answerIds = rows.filter((r) => !r.deletedAt && r.kind === "bot" && r.botCard === null).map((r) => r.id);
  const [media, links, captures, pins, pinNotes, reactions, categoryOf, receiptOf, ideasOf] = await Promise.all([
    db
      .select({
        id: schema.entryMedia.id,
        entryId: schema.entryMedia.entryId,
        uploadId: schema.entryMedia.uploadId,
        role: schema.entryMedia.role,
        width: schema.entryMedia.width,
        height: schema.entryMedia.height,
      })
      .from(schema.entryMedia)
      .where(and(inArray(schema.entryMedia.entryId, ids), inArray(schema.entryMedia.role, ["photo", "screenshot"])))
      .orderBy(asc(schema.entryMedia.position)),
    db
      .select({
        entryId: schema.linkPreviews.entryId,
        url: schema.linkPreviews.url,
        title: schema.linkPreviews.title,
        siteName: schema.linkPreviews.siteName,
        hasImage: sql<boolean>`${schema.linkPreviews.imageKey} is not null`,
      })
      .from(schema.linkPreviews)
      .where(inArray(schema.linkPreviews.entryId, ids)),
    db
      .select({ entryId: schema.captures.entryId, pageUrl: schema.captures.pageUrl, pageTitle: schema.captures.pageTitle })
      .from(schema.captures)
      .where(inArray(schema.captures.entryId, ids)),
    db
      .select({ entryId: schema.pins.captureEntryId, number: schema.pins.number, x: schema.pins.x, y: schema.pins.y })
      .from(schema.pins)
      .where(inArray(schema.pins.captureEntryId, ids))
      .orderBy(asc(schema.pins.number)),
    db
      .selectDistinctOn([schema.comments.entryId], { entryId: schema.comments.entryId, body: schema.comments.body })
      .from(schema.comments)
      .innerJoin(schema.pins, eq(schema.pins.id, schema.comments.pinId))
      .where(and(inArray(schema.comments.entryId, ids), eq(schema.pins.number, 1)))
      .orderBy(schema.comments.entryId, asc(schema.comments.createdAt)),
    db
      .select({
        entryId: schema.reactions.entryId,
        emoji: schema.reactions.emoji,
        count: count(),
        mine: sql<boolean>`bool_or(${schema.reactions.userId} = ${viewerId})`,
      })
      .from(schema.reactions)
      .where(inArray(schema.reactions.entryId, ids))
      .groupBy(schema.reactions.entryId, schema.reactions.emoji),
    categoriesOf(db, ids),
    receiptsOf(db, receiptIds),
    ideasOn(db, answerIds),
  ]);
  const photosOf = new Map<string, FeedEntry["photos"]>();
  const screenshotOf = new Map<string, NonNullable<FeedEntry["capture"]>["screenshot"]>();
  for (const m of media) {
    if (m.role === "screenshot") {
      if (!screenshotOf.has(m.entryId)) screenshotOf.set(m.entryId, { mediaId: m.id, width: m.width, height: m.height });
    } else if (m.uploadId) {
      photosOf.set(m.entryId, [...(photosOf.get(m.entryId) ?? []), { uploadId: m.uploadId, width: m.width, height: m.height }]);
    }
  }
  const pinsOf = new Map<string, NonNullable<FeedEntry["capture"]>["pins"]>();
  for (const { entryId, ...pin } of pins) pinsOf.set(entryId, [...(pinsOf.get(entryId) ?? []), pin]);
  const noteOf = new Map(pinNotes.map((n) => [n.entryId, n.body]));
  const reactionsOf = new Map<string, FeedEntry["reactions"]>();
  for (const emoji of REACTIONS) {
    for (const r of reactions) {
      if (r.emoji !== emoji) continue;
      reactionsOf.set(r.entryId, [...(reactionsOf.get(r.entryId) ?? []), { emoji, count: Number(r.count), mine: Boolean(r.mine) }]);
    }
  }
  const linkOf = new Map(links.map(({ entryId, ...l }) => [entryId, l]));
  const captureOf = new Map(
    captures.map(({ entryId, ...c }) => [
      entryId,
      { ...c, screenshot: screenshotOf.get(entryId) ?? null, pins: pinsOf.get(entryId) ?? [], note: noteOf.get(entryId) ?? null },
    ]),
  );

  return rows.map((r) =>
    r.deletedAt
      ? toFeedEntry(r)
      : {
          ...toFeedEntry(r),
          photos: photosOf.get(r.id) ?? [],
          link: linkOf.get(r.id) ?? null,
          capture: captureOf.get(r.id) ?? null,
          reactions: reactionsOf.get(r.id) ?? [],
          replyTo: (r.replyToId && quoteOf.get(r.replyToId)) || null,
          categories: categoryOf.get(r.id) ?? [],
          receipt: receiptIds.includes(r.id) ? (receiptOf.get(r.id) ?? { count: 0, categories: [] }) : null,
          ideas: ideasOf.get(r.id) ?? [],
        },
  );
}

/** The originals that live entries reply to, from the same project only, one level deep. */
async function quotedEntries(db: Database, rows: Row[], viewerId: string): Promise<Map<string, FeedEntry>> {
  const wanted = rows.filter((r) => !r.deletedAt && r.replyToId);
  if (wanted.length === 0) return new Map();
  const originals = await db
    .select(rowColumns)
    .from(schema.entries)
    .leftJoin(schema.users, eq(schema.users.id, schema.entries.authorId))
    .where(inArray(schema.entries.id, [...new Set(wanted.map((r) => r.replyToId!))]));
  const projectOf = new Map(rows.map((r) => [r.id, r.projectId]));
  const sameProject = originals.filter((o) => wanted.some((r) => r.replyToId === o.id && projectOf.get(r.id) === o.projectId));
  const details = await withDetails(db, sameProject, viewerId, { quotes: false });
  return new Map(details.map((e) => [e.id, e]));
}

/** Kasa Bot answers' ideas, in order, with what became of each (P-20). */
async function ideasOn(db: Database, cardIds: string[]): Promise<Map<string, FeedIdea[]>> {
  if (cardIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: schema.botIdeas.id,
      entryId: schema.botIdeas.entryId,
      url: schema.botIdeas.url,
      title: schema.botIdeas.title,
      note: schema.botIdeas.note,
      siteName: schema.botIdeas.siteName,
      hasImage: sql<boolean>`${schema.botIdeas.imageKey} is not null`,
      addedEntryId: schema.botIdeas.addedEntryId,
      // The category the added link is in now, which may have been renamed or changed since.
      // Spelled out: drizzle leaves columns unqualified in a one-table select.
      addedCategory: sql<string | null>`(select c.name from entry_categories ec join categories c on c.id = ec.category_id where ec.entry_id = bot_ideas.added_entry_id order by ec.created_at limit 1)`,
    })
    .from(schema.botIdeas)
    .where(inArray(schema.botIdeas.entryId, cardIds))
    .orderBy(asc(schema.botIdeas.position));
  const byCard = new Map<string, FeedIdea[]>();
  for (const { entryId, addedEntryId, addedCategory, ...idea } of rows) {
    const feedIdea: FeedIdea = { ...idea, hasImage: Boolean(idea.hasImage), added: addedEntryId ? { entryId: addedEntryId, category: addedCategory } : null };
    byCard.set(entryId, [...(byCard.get(entryId) ?? []), feedIdea]);
  }
  return byCard;
}

/** The entry without its details; all a deleted entry ever shows. */
function toFeedEntry(r: Row): FeedEntry {
  return {
    id: r.id,
    kind: r.kind,
    body: r.deletedAt ? null : r.body,
    // An undone sorting receipt keeps its card type, so the feed can leave it out (P-19).
    botCard: r.deletedAt && !(r.kind === "bot" && r.botCard && RECEIPT_CARDS.includes(r.botCard)) ? null : r.botCard,
    botEntriesRead: r.deletedAt ? null : r.botEntriesRead,
    createdAt: r.createdAt.toISOString(),
    author: r.authorId ? { id: r.authorId, name: r.authorName ?? "" } : null,
    deleted: r.deletedAt !== null,
    deletedBy: r.deletedAt && r.deletedById ? { id: r.deletedById, name: r.deletedByName ?? "" } : null,
    photos: [],
    link: null,
    capture: null,
    reactions: [],
    replyTo: null,
    categories: [],
    receipt: null,
    ideas: [],
    fromBot: !r.deletedAt && r.suggestedBy !== null,
  };
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * A Kasa Bot card replying to `questionId`, "pending" until the worker answers (P-17). It says
 * how much the bot will read, counted the way the worker reads it, for "Reading 24 entries…"
 * (D-199). clock_timestamp() puts it after the question, which has the transaction's now().
 */
export async function insertPendingCard(tx: Tx | Database, projectId: string, questionId: string): Promise<string> {
  const [readable] = await tx
    .select({ n: count() })
    .from(schema.entries)
    .where(and(eq(schema.entries.projectId, projectId), isNull(schema.entries.deletedAt), or(ne(schema.entries.kind, "bot"), isNull(schema.entries.botCard))));
  const botEntriesRead = Math.min(readable?.n ?? 0, BOT_MAX_CONTEXT_ENTRIES);
  const [bot] = await tx
    .insert(schema.entries)
    .values({ projectId, authorId: null, kind: "bot", replyToId: questionId, botCard: "pending", botEntriesRead, createdAt: sql`clock_timestamp()` })
    .returning({ id: schema.entries.id });
  return bot!.id;
}

/** Queues the answer for a pending card, or says it failed on the card rather than leaving it pending forever. */
export async function queueAnswer(db: Database, jobs: JobQueue, botEntryId: string, projectId: string): Promise<void> {
  try {
    await jobs.send("bot.answer", { entryId: botEntryId });
  } catch (error) {
    log.error("bot answer not queued", { "entry.id": botEntryId, "project.id": projectId, ...errorAttributes(error) });
    await db.update(schema.entries).set({ botCard: "failed" }).where(eq(schema.entries.id, botEntryId));
  }
}

/** One entry as the feed shows it to `viewerId`; access is the caller's to check. */
export async function feedEntryById(db: Database, entryId: string, viewerId: string): Promise<FeedEntry | null> {
  const row = await rowById(db, entryId);
  return row ? (await withDetails(db, [row], viewerId))[0]! : null;
}

export async function botMode(db: Database, projectId: string) {
  const [row] = await db.select({ mode: schema.projects.botMode }).from(schema.projects).where(eq(schema.projects.id, projectId));
  return row?.mode ?? "off";
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
 * a lone URL makes a Link entry (D-149); anything else is a Note. `mentions` are the ids of
 * people picked from the @ autocomplete (D-164). With `jobs`, links are queued for unfurling
 * (P-05) and replies and mentions for email (P-12); the entry is saved even if queueing fails.
 */
export async function createEntry(
  db: Database,
  userId: string,
  projectId: string,
  input: { text?: unknown; uploadIds?: unknown; replyToId?: unknown; mentions?: unknown },
  jobs?: JobQueue,
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
  const mentions = parseMentions(input.mentions);
  if (!mentions.ok) return mentions;

  // A reply answers a live entry in the same project (D-006).
  let original: Row | undefined;
  if (input.replyToId !== undefined && input.replyToId !== null) {
    if (!isUuid(input.replyToId)) return fail(400, "replyToId must be an entry id");
    original = await rowById(db, input.replyToId);
    if (!original || original.projectId !== projectId || original.deletedAt) return fail(404, "The entry you're replying to is gone");
  }

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
  // Tagging @kasa in a note or caption asks Kasa Bot (P-17), unless the pile turned it off.
  // Without a queue nothing would fill in the answer, so no card is made.
  const botOn = !!jobs && (await botMode(db, projectId)) !== "off";
  const asksKasa = botOn && kind !== "link" && tagsKasa(text);

  let recipients: string[] = [];
  let botEntryId: string | null = null;
  const entryId = await db
    .transaction(async (tx) => {
    const [entry] = await tx
      .insert(schema.entries)
      .values({ projectId, authorId: userId, kind, body: kind === "link" ? null : text || null, source: "app", replyToId: original?.id ?? null })
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
    recipients = await recordNotifications(tx, { id: entry!.id, projectId, authorId: userId }, original?.authorId ?? null, mentions.value);
    if (asksKasa) botEntryId = await insertPendingCard(tx, projectId, entry!.id);
    return entry!.id;
    })
    // Two sends racing with the same image: the unique index lets only one through.
    .catch((error: unknown) => {
      if (isUniqueViolation(error)) return null;
      throw error;
    });
  if (!entryId) return fail(409, "Some photos aren't ready or can't be used");

  if (jobs) {
    try {
      if (kind === "link") await jobs.send("link.unfurl", { entryId });
      // Posts are sorted into categories (P-19); links once they're unfurled, by the worker.
      else if (!original && botOn) await sendSort(jobs, projectId);
      await queueNotifications(db, jobs, projectId, recipients);
    } catch (error) {
      log.error("follow-up jobs not queued", { "entry.id": entryId, "project.id": projectId, ...errorAttributes(error) });
    }
    if (botEntryId) await queueAnswer(db, jobs, botEntryId, projectId);
  }
  // Entry ids let the pilot dashboard join replies to what they answer (G1, docs/pilot-dashboard.md).
  await track("entry_created", userId, { projectId, entryId, kind, source: "app" });
  if (original)
    await track("reply_created", userId, { projectId, entryId, replyToId: original.id, kind, toKind: original.kind, own: original.authorId === userId });
  return ok((await withDetails(db, [(await rowById(db, entryId))!], userId))[0]!);
}

/** A live entry and the user's access to its project; 404 for missing, deleted, or not-a-member alike. */
async function entryWithAccess(db: Database, userId: string, entryId: string) {
  const row = isUuid(entryId) ? await rowById(db, entryId) : undefined;
  const access = row ? await projectAccess(db, userId, row.projectId) : null;
  return row && canRead(access) ? { row, access: access! } : null;
}

/** Soft-deletes an entry, leaving an outline in the feed (D-015, D-155). Deleting twice is fine. */
export async function deleteEntry(db: Database, userId: string, entryId: string): Promise<Result<FeedEntry>> {
  const found = await entryWithAccess(db, userId, entryId);
  if (!found) return fail(404, "Entry not found");
  const { row, access } = found;
  if (!canDeleteEntry(access, row.authorId, userId)) {
    return fail(403, access.archived ? "Project is archived" : "Only the author or the owner can delete this");
  }
  if (!row.deletedAt) {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.entries)
        .set({ deletedAt: sql`now()`, deletedBy: userId })
        .where(and(eq(schema.entries.id, entryId), isNull(schema.entries.deletedAt)));
      // A deleted link from an idea makes the idea addable again (P-20).
      if (row.suggestedBy) await tx.update(schema.botIdeas).set({ addedEntryId: null }).where(eq(schema.botIdeas.addedEntryId, entryId));
    });
    await track("entry_deleted", userId, { projectId: row.projectId, kind: row.kind, own: row.authorId === userId });
  }
  return ok(toFeedEntry((await rowById(db, entryId))!));
}

/** Adds or removes the user's reaction (D-154); returns the entry's reactions afterwards. */
export async function setReaction(
  db: Database,
  userId: string,
  entryId: string,
  input: { emoji?: unknown },
  on: boolean,
): Promise<Result<{ reactions: FeedEntry["reactions"] }>> {
  if (!isReaction(input.emoji)) return fail(400, `emoji must be one of ${REACTIONS.join(" ")}`);
  const found = await entryWithAccess(db, userId, entryId);
  if (!found || found.row.deletedAt) return fail(404, "Entry not found");
  if (!canReact(found.access)) return fail(403, found.access.archived ? "Project is archived" : "Viewers can't react");

  const key = and(eq(schema.reactions.entryId, entryId), eq(schema.reactions.userId, userId), eq(schema.reactions.emoji, input.emoji));
  if (on) {
    const added = await db.insert(schema.reactions).values({ entryId, userId, emoji: input.emoji }).onConflictDoNothing().returning();
    if (added.length) await track("reaction_added", userId, { projectId: found.row.projectId, emoji: input.emoji });
  } else {
    await db.delete(schema.reactions).where(key);
  }
  const [entry] = await withDetails(db, [found.row], userId);
  return ok({ reactions: entry!.reactions });
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** Opening the feed marks everything read (D-147); never moves backwards. */
export async function markRead(db: Database, userId: string, projectId: string, opened = false): Promise<Result<{ ok: true }>> {
  if (!isUuid(projectId)) return fail(404, "Project not found");
  const rows = await db
    .update(schema.memberships)
    .set({ lastReadAt: sql`greatest(coalesce(${schema.memberships.lastReadAt}, 'epoch'::timestamptz), now())` })
    .where(and(eq(schema.memberships.projectId, projectId), eq(schema.memberships.userId, userId)))
    .returning({ projectId: schema.memberships.projectId });
  if (!rows.length) return fail(404, "Project not found");
  // Counted from the browser opening the feed, not the server render, which prefetching can trigger.
  if (opened) await track("feed_opened", userId, { projectId });
  return ok({ ok: true });
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

/**
 * The storage key behind an entry's image: a screenshot or photo (`mediaId`) or the
 * link preview image. Members only; nothing for deleted entries.
 */
export async function entryImageKey(
  db: Database,
  userId: string,
  entryId: string,
  image: { mediaId: string } | { ideaId: string } | "preview",
): Promise<string | null> {
  const found = await entryWithAccess(db, userId, entryId);
  if (!found || found.row.deletedAt) return null;
  if (typeof image === "object" && "ideaId" in image) {
    if (!isUuid(image.ideaId)) return null;
    const [row] = await db
      .select({ key: schema.botIdeas.imageKey })
      .from(schema.botIdeas)
      .where(and(eq(schema.botIdeas.id, image.ideaId), eq(schema.botIdeas.entryId, entryId)));
    return row?.key ?? null;
  }
  if (image === "preview") {
    const [row] = await db.select({ key: schema.linkPreviews.imageKey }).from(schema.linkPreviews).where(eq(schema.linkPreviews.entryId, entryId));
    return row?.key ?? null;
  }
  if (!isUuid(image.mediaId)) return null;
  const [row] = await db
    .select({ key: schema.entryMedia.storageKey })
    .from(schema.entryMedia)
    .where(and(eq(schema.entryMedia.id, image.mediaId), eq(schema.entryMedia.entryId, entryId)));
  return row?.key ?? null;
}
