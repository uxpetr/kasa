// Replies and @mentions that may become emails (P-12). The web app records them and
// queues `notify.send`; the worker batches and sends (D-163, D-165, D-167).
import { and, eq, inArray, schema, type Database } from "@kasa/db";
import { nextEmailAt, notifyKey, type JobQueue } from "@kasa/jobs";
import { verifyUnsubscribeToken } from "@kasa/shared/unsubscribe";
import { fail, isUuid, ok, type Result } from "./result";
import { projectAccess } from "./access";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export const MAX_MENTIONS = 20;

/** Validates `mentions` from the composer: the ids of people picked from the autocomplete (D-164). */
export function parseMentions(value: unknown): Result<string[]> {
  if (value === undefined || value === null) return ok([]);
  if (!Array.isArray(value) || !value.every(isUuid)) return fail(400, "mentions must be a list of user ids");
  if (value.length > MAX_MENTIONS) return fail(400, `At most ${MAX_MENTIONS} mentions per message`);
  return ok([...new Set(value)]);
}

/**
 * Records who should hear about a new entry: the author of the entry it replies to, and
 * everyone picked as a mention. Never the author, never non-members, never muted members.
 * A reply that also mentions its recipient counts once, as a reply. Returns the recipients.
 */
export async function recordNotifications(
  tx: Tx | Database,
  entry: { id: string; projectId: string; authorId: string | null },
  replyToAuthorId: string | null,
  mentionIds: string[],
): Promise<string[]> {
  const kinds = new Map<string, "reply" | "mention">();
  for (const id of mentionIds) kinds.set(id, "mention");
  if (replyToAuthorId) kinds.set(replyToAuthorId, "reply");
  if (entry.authorId) kinds.delete(entry.authorId);
  if (!kinds.size) return [];

  const members = await tx
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.projectId, entry.projectId),
        inArray(schema.memberships.userId, [...kinds.keys()]),
        eq(schema.memberships.emailsMuted, false),
      ),
    );
  if (!members.length) return [];
  await tx
    .insert(schema.notifications)
    .values(members.map(({ userId }) => ({ userId, projectId: entry.projectId, entryId: entry.id, kind: kinds.get(userId)! })))
    .onConflictDoNothing();
  return members.map((m) => m.userId);
}

/** Queues one `notify.send` per recipient, no earlier than their 15-minute window allows. */
export async function queueNotifications(db: Database, queue: JobQueue, projectId: string, userIds: string[]): Promise<void> {
  if (!userIds.length) return;
  const rows = await db
    .select({ userId: schema.memberships.userId, lastEmailedAt: schema.memberships.lastEmailedAt })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.projectId, projectId), inArray(schema.memberships.userId, userIds)));
  for (const row of rows) {
    await queue.send(
      "notify.send",
      { userId: row.userId, projectId },
      { startAfter: nextEmailAt(row.lastEmailedAt), singletonKey: notifyKey(row.userId, projectId) },
    );
  }
}

/** Mute or unmute emails for one project, from the project menu (D-165). Any member. */
export async function setEmailsMuted(db: Database, userId: string, projectId: string, muted: unknown): Promise<Result<{ muted: boolean }>> {
  const access = isUuid(projectId) ? await projectAccess(db, userId, projectId) : null;
  if (!access) return fail(404, "Project not found");
  if (typeof muted !== "boolean") return fail(400, "muted must be true or false");
  await db
    .update(schema.memberships)
    .set({ emailsMuted: muted })
    .where(and(eq(schema.memberships.projectId, projectId), eq(schema.memberships.userId, userId)));
  return ok({ muted });
}

/** Whether a member has muted a project's emails. */
export async function emailsMuted(db: Database, userId: string, projectId: string): Promise<boolean> {
  const [row] = await db
    .select({ muted: schema.memberships.emailsMuted })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.projectId, projectId), eq(schema.memberships.userId, userId)));
  return row?.muted ?? false;
}

/**
 * The unsubscribe link (D-165): mutes (or, from the page's Unmute button, unmutes) one
 * project for the person the token was signed for. No sign-in; the token is the proof.
 */
export async function unsubscribe(
  db: Database,
  secret: string | undefined,
  token: unknown,
  muted: boolean,
): Promise<Result<{ projectId: string; projectName: string; muted: boolean }>> {
  const claims = verifyUnsubscribeToken(secret, token);
  if (!claims) return fail(404, "This link isn't valid");
  const [project] = await db.select({ name: schema.projects.name }).from(schema.projects).where(eq(schema.projects.id, claims.projectId));
  if (!project) return fail(404, "This link isn't valid");
  await db
    .update(schema.memberships)
    .set({ emailsMuted: muted })
    .where(and(eq(schema.memberships.projectId, claims.projectId), eq(schema.memberships.userId, claims.userId)));
  return ok({ projectId: claims.projectId, projectName: project.name, muted });
}
