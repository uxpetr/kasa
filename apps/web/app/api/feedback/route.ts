import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { sendFeedback } from "@/lib/feedback";
import { requestLog } from "@/lib/log";
import { toResponse } from "@/lib/result";
import { getQueue } from "@/lib/services";

/** POST { text, page? } -> 201 { id }: pilot feedback from the account menu (D-181). Anyone signed in. */
export async function POST(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const log = requestLog(request.headers).child({ "user.id": user.id });
  // Without the queue it's still stored; it just isn't emailed.
  const queue = await getQueue().catch((error: unknown) => {
    log.error("queue unavailable", { message: error instanceof Error ? error.message : String(error) });
    return undefined;
  });
  return toResponse(await sendFeedback(getDb(), user.id, body, queue), 201);
}
