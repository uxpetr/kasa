// Kasa Bot's recommendations (P-20, D-204): "Add to pile" turns an idea into a link posted by the
// member who clicked, filed into the category the bot suggested; "More ideas" asks again.
// Access: members see ideas; owners and editors add them and ask for more, unless archived.
import { and, eq, inArray, isNull, schema, sql, type Database } from "@kasa/db";
import { sendSort, type JobQueue } from "@kasa/jobs";
import { errorAttributes } from "@kasa/observability";
import { track } from "@kasa/shared";
import { canAdd, canRead, projectAccess } from "./access";
import { botMode, feedEntryById, insertPendingCard, queueAnswer, type FeedEntry } from "./entries";
import { log } from "./log";
import { queueTelegram } from "./telegram";
import { fail, isUuid, ok, type Result } from "./result";

/** A live Kasa Bot answer and the user's access to its pile; null for missing, deleted, or not-a-member alike. */
async function answerCard(db: Database, userId: string, cardId: string) {
  const [card] = await db
    .select({ id: schema.entries.id, projectId: schema.entries.projectId, replyToId: schema.entries.replyToId, botCard: schema.entries.botCard })
    .from(schema.entries)
    .where(and(eq(schema.entries.id, cardId), eq(schema.entries.kind, "bot"), isNull(schema.entries.deletedAt)));
  const access = card ? await projectAccess(db, userId, card.projectId) : null;
  return card && canRead(access) ? { card, access: access! } : null;
}

const refused = (access: { archived: boolean }) => fail<FeedEntry>(403, access.archived ? "Project is archived" : "Viewers can't add to the pile");

/** POST on an idea: posts it as the member's link, once. Returns the new link entry, or the one already added. */
export async function addIdea(db: Database, userId: string, ideaId: string, jobs?: JobQueue): Promise<Result<FeedEntry>> {
  if (!isUuid(ideaId)) return fail(404, "Idea not found");
  const [idea] = await db.select().from(schema.botIdeas).where(eq(schema.botIdeas.id, ideaId));
  const found = idea ? await answerCard(db, userId, idea.entryId) : null;
  if (!idea || !found) return fail(404, "Idea not found");
  if (!canAdd(found.access)) return refused(found.access);
  const projectId = found.card.projectId;

  const result = await db.transaction(async (tx) => {
    // Two clicks at once add it once.
    const [locked] = await tx.select({ addedEntryId: schema.botIdeas.addedEntryId }).from(schema.botIdeas).where(eq(schema.botIdeas.id, ideaId)).for("update");
    if (locked?.addedEntryId) return { entryId: locked.addedEntryId, created: false, filed: false };
    // The suggested category, if the pile still has one by that name.
    const [category] = idea.category
      ? await tx
          .select({ id: schema.categories.id })
          .from(schema.categories)
          .where(and(eq(schema.categories.projectId, projectId), sql`lower(${schema.categories.name}) = lower(${idea.category})`))
      : [];
    const [entry] = await tx
      .insert(schema.entries)
      .values({
        projectId,
        authorId: userId,
        kind: "link",
        source: "app",
        suggestedBy: found.card.id,
        // Filed now, so Kasa Bot doesn't sort it again; without a category it's sorted like any link.
        sortedAt: category ? sql`now()` : null,
      })
      .returning({ id: schema.entries.id });
    // The page was already read for the idea; the link reuses its title and picture.
    await tx.insert(schema.linkPreviews).values({ entryId: entry!.id, url: idea.url, title: idea.title, siteName: idea.siteName, imageKey: idea.imageKey });
    if (category) await tx.insert(schema.entryCategories).values({ entryId: entry!.id, categoryId: category.id, assignedBy: "bot" });
    await tx.update(schema.botIdeas).set({ addedEntryId: entry!.id }).where(eq(schema.botIdeas.id, ideaId));
    return { entryId: entry!.id, created: true, filed: !!category };
  });

  if (result.created) {
    if (jobs) await queueTelegram(db, jobs, projectId, result.entryId);
    if (jobs && !result.filed && (await botMode(db, projectId)) !== "off") {
      await sendSort(jobs, projectId).catch((error: unknown) => log.error("sort not queued", { "project.id": projectId, ...errorAttributes(error) }));
    }
    await track("entry_created", userId, { projectId, entryId: result.entryId, kind: "link", source: "app" });
    await track("idea_added", userId, { projectId, entryId: result.entryId, cardId: found.card.id, filed: result.filed });
  }
  const entry = await feedEntryById(db, result.entryId, userId);
  return entry && !entry.deleted ? ok(entry) : fail(409, "That idea was added and then deleted");
}

/** POST on a Kasa Bot answer with ideas: a new card on the same question with different ones (D-204). */
export async function moreIdeas(db: Database, userId: string, cardId: string, jobs?: JobQueue): Promise<Result<FeedEntry>> {
  if (!isUuid(cardId)) return fail(404, "Entry not found");
  const found = await answerCard(db, userId, cardId);
  const questionId = found?.card.replyToId;
  if (!found || found.card.botCard !== null || !questionId) return fail(404, "Entry not found");
  const { card, access } = found;
  if (!canAdd(access)) return refused(access);
  const [hasIdeas] = await db.select({ id: schema.botIdeas.id }).from(schema.botIdeas).where(eq(schema.botIdeas.entryId, card.id)).limit(1);
  if (!hasIdeas) return fail(404, "Entry not found");
  // Without a queue nothing would fill the card in.
  if (!jobs || (await botMode(db, card.projectId)) === "off") return fail(409, "Kasa Bot is off in this pile");

  const botEntryId = await db.transaction(async (tx) => {
    const [question] = await tx
      .select({ id: schema.entries.id })
      .from(schema.entries)
      .where(and(eq(schema.entries.id, questionId), eq(schema.entries.projectId, card.projectId), isNull(schema.entries.deletedAt)))
      .for("update");
    if (!question) return null;
    // A second click while Kasa Bot is still looking gets the same card.
    const [open] = await tx
      .select({ id: schema.entries.id })
      .from(schema.entries)
      .where(
        and(
          eq(schema.entries.replyToId, questionId),
          eq(schema.entries.kind, "bot"),
          inArray(schema.entries.botCard, ["pending", "writing"]),
          isNull(schema.entries.deletedAt),
        ),
      );
    if (open) return { id: open.id, created: false };
    return { id: await insertPendingCard(tx, card.projectId, questionId), created: true };
  });
  if (!botEntryId) return fail(404, "The question is gone");
  if (botEntryId.created) await queueAnswer(db, jobs, botEntryId.id, card.projectId);
  return ok((await feedEntryById(db, botEntryId.id, userId))!);
}
