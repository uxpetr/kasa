// Kasa Bot categories (P-19, D-201): chips above the feed, stamps on entries, and members' fixes.
// Kasa Bot makes and fills categories in the worker (apps/worker/src/bot/sort.ts); members move
// entries, add, rename, merge, and remove them here, and can undo a sorting receipt.
// Categories never change the feed's order.
import { and, asc, count, eq, gte, inArray, isNull, schema, sql, type Database } from "@kasa/db";
import { MAX_CATEGORIES, MAX_CATEGORY_NAME, SORTABLE_KINDS, track } from "@kasa/shared";
import { canEditCategories, canRead, projectAccess } from "./access";
import { fail, isUuid, ok, type Result } from "./result";

export interface Category {
  id: string;
  name: string;
}

export interface CategoryChipData extends Category {
  /** Live posts in the category. */
  count: number;
}

/** What a sorting receipt lists (D-201): how many posts, and the categories they went into. */
export interface ReceiptSummary {
  count: number;
  categories: string[];
}

/** The receipts' bot_card values: the first sort names the pile's categories; later ones have Undo. */
export const RECEIPT_CARDS = ["sorted", "sorted-first"];

const sortableKinds = [...SORTABLE_KINDS] as string[];
const isSortable = (row: { kind: string; replyToId: string | null; deletedAt: Date | null }) =>
  sortableKinds.includes(row.kind) && row.replyToId === null && row.deletedAt === null;

/** A pile's categories in the order they were made, with how many live posts are in each. */
export async function listCategories(db: Database, projectId: string): Promise<CategoryChipData[]> {
  const rows = await db
    .select({
      id: schema.categories.id,
      name: schema.categories.name,
      count: sql<number>`count(${schema.entries.id})::int`,
    })
    .from(schema.categories)
    .leftJoin(schema.entryCategories, eq(schema.entryCategories.categoryId, schema.categories.id))
    .leftJoin(schema.entries, and(eq(schema.entries.id, schema.entryCategories.entryId), isNull(schema.entries.deletedAt)))
    .where(eq(schema.categories.projectId, projectId))
    .groupBy(schema.categories.id)
    .orderBy(asc(schema.categories.createdAt), asc(schema.categories.name));
  return rows.map((r) => ({ ...r, count: Number(r.count) }));
}

/** Live posts in the pile, for the "All" chip: what categories sort, not replies or bot cards. */
export async function countPosts(db: Database, projectId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.entries)
    .where(
      and(
        eq(schema.entries.projectId, projectId),
        isNull(schema.entries.deletedAt),
        isNull(schema.entries.replyToId),
        inArray(schema.entries.kind, [...SORTABLE_KINDS]),
      ),
    );
  return row?.n ?? 0;
}

/** Each entry's categories, in chip order. */
export async function categoriesOf(db: Database, entryIds: string[]): Promise<Map<string, Category[]>> {
  const result = new Map<string, Category[]>();
  if (entryIds.length === 0) return result;
  const rows = await db
    .select({ entryId: schema.entryCategories.entryId, id: schema.categories.id, name: schema.categories.name })
    .from(schema.entryCategories)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.entryCategories.categoryId))
    .where(inArray(schema.entryCategories.entryId, entryIds))
    .orderBy(asc(schema.categories.createdAt), asc(schema.categories.name));
  for (const { entryId, ...c } of rows) result.set(entryId, [...(result.get(entryId) ?? []), c]);
  return result;
}

/** What each receipt lists, from the bot's assignments still in place. */
export async function receiptsOf(db: Database, receiptIds: string[]): Promise<Map<string, ReceiptSummary>> {
  const result = new Map<string, ReceiptSummary>();
  if (receiptIds.length === 0) return result;
  const rows = await db
    .select({ receiptId: schema.entryCategories.receiptId, entryId: schema.entryCategories.entryId, name: schema.categories.name })
    .from(schema.entryCategories)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.entryCategories.categoryId))
    .innerJoin(schema.entries, eq(schema.entries.id, schema.entryCategories.entryId))
    .where(and(inArray(schema.entryCategories.receiptId, receiptIds), isNull(schema.entries.deletedAt)))
    .orderBy(asc(schema.categories.createdAt), asc(schema.categories.name));
  const grouped = new Map<string, { entries: Set<string>; names: string[] }>();
  for (const r of rows) {
    const g = grouped.get(r.receiptId!) ?? { entries: new Set(), names: [] };
    g.entries.add(r.entryId);
    if (!g.names.includes(r.name)) g.names.push(r.name);
    grouped.set(r.receiptId!, g);
  }
  for (const [id, g] of grouped) result.set(id, { count: g.entries.size, categories: g.names });
  return result;
}

/** Trimmed, single-spaced, and short enough; null when empty. */
export function categoryName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  return name && name.length <= MAX_CATEGORY_NAME ? name : null;
}
const nameError = `A category name is 1 to ${MAX_CATEGORY_NAME} characters`;

async function editAccess(db: Database, userId: string, projectId: string) {
  const access = isUuid(projectId) ? await projectAccess(db, userId, projectId) : null;
  if (!canRead(access)) return fail<never>(404, "Project not found");
  if (!canEditCategories(access)) return fail<never>(403, access!.archived ? "Project is archived" : "Viewers can't change categories");
  return null;
}

async function nameTaken(db: Database, projectId: string, name: string, except?: string) {
  const rows = await db
    .select({ id: schema.categories.id })
    .from(schema.categories)
    .where(and(eq(schema.categories.projectId, projectId), sql`lower(${schema.categories.name}) = lower(${name})`));
  return rows.some((r) => r.id !== except);
}

/** A member adds a category; Kasa Bot then files into it too. */
export async function createCategory(db: Database, userId: string, projectId: string, input: { name?: unknown }): Promise<Result<Category>> {
  const denied = await editAccess(db, userId, projectId);
  if (denied) return denied;
  const name = categoryName(input.name);
  if (!name) return fail(400, nameError);
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(schema.categories).where(eq(schema.categories.projectId, projectId));
  if (n >= MAX_CATEGORIES) return fail(409, `A pile can have up to ${MAX_CATEGORIES} categories`);
  if (await nameTaken(db, projectId, name)) return fail(409, `There's already a category called ${name}`);
  const [row] = await db
    .insert(schema.categories)
    .values({ projectId, name, createdBy: "user" })
    .onConflictDoNothing()
    .returning({ id: schema.categories.id, name: schema.categories.name });
  if (!row) return fail(409, `There's already a category called ${name}`);
  await track("category_changed", userId, { projectId, action: "add" });
  return ok(row);
}

async function categoryWithAccess(db: Database, userId: string, categoryId: string) {
  if (!isUuid(categoryId)) return { error: fail<never>(404, "Category not found") };
  const [row] = await db.select().from(schema.categories).where(eq(schema.categories.id, categoryId));
  // A category in a pile the user can't see is "not found", like a missing one.
  const access = row ? await projectAccess(db, userId, row.projectId) : null;
  if (!row || !canRead(access)) return { error: fail<never>(404, "Category not found") };
  if (!canEditCategories(access)) return { error: fail<never>(403, access!.archived ? "Project is archived" : "Viewers can't change categories") };
  return { row };
}

/** Renames a category, or merges it into another one in the same pile, which then keeps its entries. */
export async function updateCategory(
  db: Database,
  userId: string,
  categoryId: string,
  input: { name?: unknown; mergeInto?: unknown },
): Promise<Result<Category>> {
  const found = await categoryWithAccess(db, userId, categoryId);
  if (found.error) return found.error;
  const { row } = found;

  if (input.mergeInto !== undefined) {
    if (!isUuid(input.mergeInto) || input.mergeInto === row.id) return fail(400, "Pick another category to merge into");
    const [target] = await db
      .select({ id: schema.categories.id, name: schema.categories.name })
      .from(schema.categories)
      .where(and(eq(schema.categories.id, input.mergeInto), eq(schema.categories.projectId, row.projectId)));
    if (!target) return fail(404, "Category not found");
    await db.transaction(async (tx) => {
      // A merge is a member's choice, so the moved entries count as fixes the bot learns from.
      await tx.execute(sql`
        insert into ${schema.entryCategories} (entry_id, category_id, assigned_by)
        select entry_id, ${target.id}, 'user' from ${schema.entryCategories} where category_id = ${row.id}
        on conflict do nothing`);
      await tx.delete(schema.categories).where(eq(schema.categories.id, row.id));
    });
    await track("category_changed", userId, { projectId: row.projectId, action: "merge" });
    return ok(target);
  }

  const name = categoryName(input.name);
  if (!name) return fail(400, nameError);
  if (name === row.name) return ok({ id: row.id, name });
  if (await nameTaken(db, row.projectId, name, row.id)) return fail(409, `There's already a category called ${name}`);
  await db.update(schema.categories).set({ name }).where(eq(schema.categories.id, row.id));
  await track("category_changed", userId, { projectId: row.projectId, action: "rename" });
  return ok({ id: row.id, name });
}

/** Removes a category; its entries stay, uncategorized, and Kasa Bot doesn't sort them again. */
export async function deleteCategory(db: Database, userId: string, categoryId: string): Promise<Result<{ ok: true }>> {
  const found = await categoryWithAccess(db, userId, categoryId);
  if (found.error) return found.error;
  await db.delete(schema.categories).where(eq(schema.categories.id, found.row.id));
  await track("category_changed", userId, { projectId: found.row.projectId, action: "remove" });
  return ok({ ok: true });
}

/** A member picks an entry's categories from the checklist; the bot won't change them afterwards. */
export async function setEntryCategories(
  db: Database,
  userId: string,
  entryId: string,
  input: { categoryIds?: unknown },
): Promise<Result<{ categories: Category[] }>> {
  if (!isUuid(entryId)) return fail(404, "Entry not found");
  const ids = input.categoryIds;
  if (!Array.isArray(ids) || !ids.every(isUuid) || new Set(ids).size !== ids.length) return fail(400, "categoryIds must be a list of ids");
  const [entry] = await db
    .select({ id: schema.entries.id, projectId: schema.entries.projectId, kind: schema.entries.kind, replyToId: schema.entries.replyToId, deletedAt: schema.entries.deletedAt })
    .from(schema.entries)
    .where(eq(schema.entries.id, entryId));
  const access = entry ? await projectAccess(db, userId, entry.projectId) : null;
  if (!entry || !canRead(access) || entry.deletedAt) return fail(404, "Entry not found");
  if (!canEditCategories(access)) return fail(403, access!.archived ? "Project is archived" : "Viewers can't change categories");
  if (!isSortable(entry)) return fail(400, "Only posts have categories, not replies or Kasa Bot's messages");

  const valid = ids.length
    ? await db
        .select({ id: schema.categories.id })
        .from(schema.categories)
        .where(and(eq(schema.categories.projectId, entry.projectId), inArray(schema.categories.id, ids)))
    : [];
  if (valid.length !== ids.length) return fail(404, "Category not found");

  await db.transaction(async (tx) => {
    const current = await tx.select({ categoryId: schema.entryCategories.categoryId }).from(schema.entryCategories).where(eq(schema.entryCategories.entryId, entryId));
    const had = new Set(current.map((c) => c.categoryId));
    const off = [...had].filter((id) => !ids.includes(id));
    const on = ids.filter((id) => !had.has(id));
    if (off.length) await tx.delete(schema.entryCategories).where(and(eq(schema.entryCategories.entryId, entryId), inArray(schema.entryCategories.categoryId, off)));
    if (on.length) await tx.insert(schema.entryCategories).values(on.map((categoryId) => ({ entryId, categoryId, assignedBy: "user" as const })));
    // Sorted now, by a member: Kasa Bot leaves it alone from here on.
    await tx.update(schema.entries).set({ sortedAt: sql`coalesce(${schema.entries.sortedAt}, now())` }).where(eq(schema.entries.id, entryId));
  });
  await track("category_changed", userId, { projectId: entry.projectId, action: "move" });
  return ok({ categories: (await categoriesOf(db, [entryId])).get(entryId) ?? [] });
}

/**
 * Undo on a sorting receipt: the bot's assignments from that burst come off, categories it made
 * that are now empty go, and the receipt leaves the feed. Entries stay sorted, so the bot won't
 * file them again.
 */
export async function undoReceipt(db: Database, userId: string, entryId: string): Promise<Result<{ ok: true }>> {
  if (!isUuid(entryId)) return fail(404, "Entry not found");
  const [receipt] = await db
    .select({ id: schema.entries.id, projectId: schema.entries.projectId, botCard: schema.entries.botCard, createdAt: schema.entries.createdAt, deletedAt: schema.entries.deletedAt })
    .from(schema.entries)
    .where(and(eq(schema.entries.id, entryId), eq(schema.entries.kind, "bot")));
  const access = receipt ? await projectAccess(db, userId, receipt.projectId) : null;
  if (!receipt || !canRead(access) || receipt.botCard !== "sorted") return fail(404, "Entry not found");
  if (!canEditCategories(access)) return fail(403, access!.archived ? "Project is archived" : "Viewers can't change categories");
  if (receipt.deletedAt) return ok({ ok: true });

  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(schema.entryCategories)
      .where(and(eq(schema.entryCategories.receiptId, receipt.id), eq(schema.entryCategories.assignedBy, "bot")))
      .returning({ categoryId: schema.entryCategories.categoryId });
    const touched = [...new Set(removed.map((r) => r.categoryId))];
    if (touched.length) {
      await tx
        .delete(schema.categories)
        .where(
          and(
            inArray(schema.categories.id, touched),
            eq(schema.categories.createdBy, "bot"),
            gte(schema.categories.createdAt, receipt.createdAt),
            sql`not exists (select 1 from ${schema.entryCategories} where ${schema.entryCategories.categoryId} = ${schema.categories.id})`,
          ),
        );
    }
    await tx.update(schema.entries).set({ deletedAt: sql`now()`, deletedBy: userId }).where(eq(schema.entries.id, receipt.id));
  });
  await track("category_changed", userId, { projectId: receipt.projectId, action: "undo" });
  return ok({ ok: true });
}
