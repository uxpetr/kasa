// Pilot feedback (D-181): anyone signed in sends a message from the account menu; it's stored
// with the page it came from, emailed to Petr by the worker, and listed for pilot admins.
import { desc, eq, schema, type Database } from "@kasa/db";
import type { JobQueue } from "@kasa/jobs";
import { errorAttributes } from "@kasa/observability";
import { track } from "@kasa/shared";
import { log } from "./log";
import { fail, ok, type Result } from "./result";

export const MAX_FEEDBACK_LENGTH = 4000;
const MAX_PAGE_LENGTH = 300;

/** A same-site path like "/projects/<id>", or null; never a full URL. */
function pageOf(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.length > MAX_PAGE_LENGTH) return null;
  return value;
}

export async function sendFeedback(db: Database, userId: string, input: unknown, jobs?: JobQueue): Promise<Result<{ id: string }>> {
  const body = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return fail(400, "Write something first");
  if (text.length > MAX_FEEDBACK_LENGTH) return fail(400, `Keep it under ${MAX_FEEDBACK_LENGTH} characters`);
  const [row] = await db.insert(schema.feedback).values({ userId, body: text, page: pageOf(body.page) }).returning({ id: schema.feedback.id });
  if (jobs) {
    try {
      await jobs.send("feedback.send", { feedbackId: row!.id });
    } catch (error) {
      // Still stored and listed at /feedback.
      log.error("feedback email not queued", { "feedback.id": row!.id, ...errorAttributes(error) });
    }
  }
  await track("feedback_sent", userId);
  return ok({ id: row!.id });
}

export interface FeedbackItem {
  id: string;
  body: string;
  page: string | null;
  createdAt: Date;
  author: { name: string; email: string } | null;
}

/** Newest first, for /feedback. */
export async function listFeedback(db: Database, limit = 500): Promise<FeedbackItem[]> {
  const rows = await db
    .select({
      id: schema.feedback.id,
      body: schema.feedback.body,
      page: schema.feedback.page,
      createdAt: schema.feedback.createdAt,
      name: schema.users.name,
      email: schema.users.email,
    })
    .from(schema.feedback)
    .leftJoin(schema.users, eq(schema.users.id, schema.feedback.userId))
    .orderBy(desc(schema.feedback.createdAt), desc(schema.feedback.id))
    .limit(limit);
  return rows.map(({ name, email, ...r }) => ({ ...r, author: email ? { name: name ?? "", email } : null }));
}

/** PILOT_ADMIN_EMAILS is a comma-separated list; empty means nobody. */
export function isPilotAdmin(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!email) return false;
  const admins = (env.PILOT_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}
