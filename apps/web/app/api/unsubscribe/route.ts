import { getDb } from "@/lib/db";
import { requestLog } from "@/lib/log";
import { unsubscribe } from "@/lib/notifications";
import { toResponse } from "@/lib/result";

/**
 * POST ?token=… -> mutes that project's emails (D-165). Also the RFC 8058 one-click target
 * that mail apps call from the List-Unsubscribe header. JSON { token, muted: false } unmutes.
 * No sign-in: the signed token names the person and project.
 */
export async function POST(request: Request) {
  const query = new URL(request.url).searchParams;
  const json = request.headers.get("content-type")?.includes("application/json")
    ? ((await request.json().catch(() => null)) as { token?: unknown; muted?: unknown } | null)
    : null;
  const token = json?.token ?? query.get("token");
  const muted = json?.muted !== false;
  const result = await unsubscribe(getDb(), process.env.UNSUBSCRIBE_SECRET, token, muted);
  const log = requestLog(request.headers);
  if (result.ok) log.info(muted ? "emails muted by link" : "emails unmuted by link", { "project.id": result.value.projectId });
  else log.warn("unsubscribe refused", { status: result.status });
  return toResponse(result);
}
