import { requestLog } from "@/lib/log";
import { getQueue } from "@/lib/services";
import { webhookAuthorized } from "@/lib/telegram";

/**
 * POST from Telegram: one update, verified by the secret Telegram echoes in a header (P-18).
 * The worker handles it; this only queues it, so Telegram gets its answer fast. A failure to queue
 * returns 500, and Telegram tries again.
 */
export async function POST(request: Request) {
  if (!webhookAuthorized(request.headers.get("x-telegram-bot-api-secret-token"))) return new Response(null, { status: 401 });
  const update = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!update || typeof update.update_id !== "number") return new Response(null, { status: 400 });
  try {
    await (await getQueue()).send("telegram.update", { update });
  } catch (error) {
    requestLog(request.headers).error("telegram update not queued", { message: error instanceof Error ? error.message : String(error) });
    return new Response(null, { status: 500 });
  }
  return new Response(null, { status: 200 });
}
