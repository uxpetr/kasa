// feedback.send (P-13, D-181): each pilot message is emailed to Petr as it arrives.
import { eq, schema, type Database } from "@kasa/db";
import type { Logger } from "@kasa/observability";
import type { Mailer } from "./notify/mailer";
import { escape } from "./notify/render";

export interface FeedbackDeps {
  db: Database;
  mailer: Mailer;
  /** FEEDBACK_EMAIL; without it messages are only stored and listed at /feedback. */
  to: string | undefined;
  appUrl: string;
  log?: Logger;
  now?: () => Date;
}

export interface FeedbackMessage {
  body: string;
  page: string | null;
  author: { name: string; email: string } | null;
}

export function renderFeedback(message: FeedbackMessage, listUrl: string) {
  const from = message.author ? `${message.author.name} <${message.author.email}>` : "A deleted user";
  const where = message.page ? ` on ${message.page}` : "";
  return {
    subject: `Kasa feedback from ${message.author?.name || "a deleted user"}`,
    text: `${message.body}\n\n— ${from}${where}\n\nAll feedback: ${listUrl}\n`,
    html:
      `<p style="white-space:pre-wrap">${escape(message.body)}</p>` +
      `<p style="color:#6b665e">— ${escape(from)}${escape(where)}</p>` +
      `<p><a href="${escape(listUrl)}">All feedback</a></p>`,
  };
}

export async function emailFeedback(deps: FeedbackDeps, feedbackId: string): Promise<void> {
  const [row] = await deps.db
    .select({
      body: schema.feedback.body,
      page: schema.feedback.page,
      emailedAt: schema.feedback.emailedAt,
      name: schema.users.name,
      email: schema.users.email,
    })
    .from(schema.feedback)
    .leftJoin(schema.users, eq(schema.users.id, schema.feedback.userId))
    .where(eq(schema.feedback.id, feedbackId));
  if (!row || row.emailedAt) return;
  if (!deps.to) {
    deps.log?.info("feedback not emailed (no FEEDBACK_EMAIL)", { "feedback.id": feedbackId });
    return;
  }
  const message = { body: row.body, page: row.page, author: row.email ? { name: row.name ?? "", email: row.email } : null };
  const email = renderFeedback(message, `${deps.appUrl.replace(/\/$/, "")}/feedback`);
  await deps.mailer.send({
    to: deps.to,
    ...email,
    // Replying goes straight to the person who wrote it.
    headers: message.author ? { "Reply-To": message.author.email } : {},
    idempotencyKey: `feedback-${feedbackId}`,
  });
  await deps.db.update(schema.feedback).set({ emailedAt: deps.now?.() ?? new Date() }).where(eq(schema.feedback.id, feedbackId));
}
