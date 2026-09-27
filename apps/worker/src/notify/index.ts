import { createHash } from "node:crypto";
import { alias, and, asc, eq, inArray, isNull, schema, type Database } from "@kasa/db";
import { EMAIL_INTERVAL_MS, notifyKey, type JobQueue } from "@kasa/jobs";
import type { Logger } from "@kasa/observability";
import { createUnsubscribeToken } from "@kasa/shared/unsubscribe";
import type { Mailer } from "./mailer";
import { renderEmail, type EmailItem } from "./render";

export interface NotifyDeps {
  db: Database;
  queue: JobQueue;
  mailer: Mailer;
  /** The web app's URL, for links in emails (BETTER_AUTH_URL). */
  appUrl: string;
  unsubscribeSecret: string | undefined;
  log?: Logger;
  now?: () => Date;
}

const original = alias(schema.entries, "original");

/**
 * notify.send (P-12): one email with everything waiting for a person in a project, at most
 * one per 15 minutes (D-163, D-165, D-167). Skipped, and marked handled: entries deleted
 * since, entries the person already saw in the app, and everything while the project is
 * muted or after they left. The membership row is locked, so two runs can't both send.
 */
export async function sendNotifications(deps: NotifyDeps, userId: string, projectId: string): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const attrs = { "user.id": userId, "project.id": projectId };

  await deps.db.transaction(async (tx) => {
    const pendingFor = and(eq(schema.notifications.userId, userId), eq(schema.notifications.projectId, projectId), isNull(schema.notifications.handledAt));
    const markHandled = (ids?: string[]) =>
      tx
        .update(schema.notifications)
        .set({ handledAt: now })
        .where(ids ? and(pendingFor, inArray(schema.notifications.id, ids)) : pendingFor);

    const [member] = await tx
      .select({
        muted: schema.memberships.emailsMuted,
        lastEmailedAt: schema.memberships.lastEmailedAt,
        lastReadAt: schema.memberships.lastReadAt,
        email: schema.users.email,
        projectName: schema.projects.name,
        projectDeleted: schema.projects.deletedAt,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .innerJoin(schema.projects, eq(schema.projects.id, schema.memberships.projectId))
      .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.projectId, projectId)))
      .for("update", { of: schema.memberships });

    if (!member || member.projectDeleted || member.muted) {
      await markHandled();
      return;
    }

    // Too soon after the last email: come back when the window opens; everything waits until then.
    const opensAt = member.lastEmailedAt ? new Date(member.lastEmailedAt.getTime() + EMAIL_INTERVAL_MS) : now;
    if (opensAt > now) {
      await deps.queue.send("notify.send", { userId, projectId }, { startAfter: opensAt, singletonKey: notifyKey(userId, projectId) });
      return;
    }

    const rows = await tx
      .select({
        id: schema.notifications.id,
        kind: schema.notifications.kind,
        entryKind: schema.entries.kind,
        body: schema.entries.body,
        createdAt: schema.entries.createdAt,
        deletedAt: schema.entries.deletedAt,
        authorName: schema.users.name,
        originalKind: original.kind,
        originalBody: original.body,
      })
      .from(schema.notifications)
      .innerJoin(schema.entries, eq(schema.entries.id, schema.notifications.entryId))
      .leftJoin(schema.users, eq(schema.users.id, schema.entries.authorId))
      .leftJoin(original, eq(original.id, schema.entries.replyToId))
      .where(pendingFor)
      .orderBy(asc(schema.entries.createdAt));

    const seen = (r: (typeof rows)[number]) => member.lastReadAt !== null && r.createdAt <= member.lastReadAt;
    const fresh = rows.filter((r) => !r.deletedAt && !seen(r));
    const skipped = rows.filter((r) => !fresh.includes(r)).map((r) => r.id);
    if (skipped.length) await markHandled(skipped);
    if (!fresh.length) return;

    const items: EmailItem[] = fresh.map((r) => ({
      kind: r.kind,
      authorName: r.entryKind === "bot" ? null : r.authorName,
      entry: { kind: r.entryKind, body: r.body },
      original: r.originalKind ? { kind: r.originalKind, body: r.originalBody } : null,
    }));
    const base = deps.appUrl.replace(/\/$/, "");
    const token = deps.unsubscribeSecret ? createUnsubscribeToken(deps.unsubscribeSecret, { userId, projectId }) : null;
    const unsubscribeUrl = token ? `${base}/unsubscribe?token=${encodeURIComponent(token)}` : `${base}/unsubscribe`;
    const email = renderEmail({ projectName: member.projectName, projectUrl: `${base}/projects/${projectId}`, unsubscribeUrl, items });
    const ids = fresh.map((r) => r.id);

    // Send while holding the lock, then commit. A retry after a failed commit reuses the
    // idempotency key, so the same batch is never sent twice.
    await deps.mailer.send({
      to: member.email,
      ...email,
      headers: token
        ? {
            // One-click unsubscribe in mail apps (RFC 8058).
            "List-Unsubscribe": `<${base}/api/unsubscribe?token=${encodeURIComponent(token)}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          }
        : {},
      idempotencyKey: createHash("sha256").update(ids.sort().join(",")).digest("hex"),
    });
    await markHandled(ids);
    await tx
      .update(schema.memberships)
      .set({ lastEmailedAt: now })
      .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.projectId, projectId)));
    deps.log?.info("notification email sent", { ...attrs, items: items.length, skipped: skipped.length, mailer: deps.mailer.kind });
  });
}
