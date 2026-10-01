import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { moreIdeas } from "@/lib/ideas";
import { requestLog } from "@/lib/log";
import { toResponse } from "@/lib/result";
import { getQueue } from "@/lib/services";

/** POST on a Kasa Bot answer with ideas -> 201 a new pending card with different ones (D-204). Owners and editors. */
export async function POST(request: Request, { params }: RouteContext<"/api/entries/[id]/more-ideas">) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  const queue = await getQueue().catch((error: unknown) => {
    requestLog(request.headers).error("queue unavailable", { message: error instanceof Error ? error.message : String(error) });
    return undefined;
  });
  return toResponse(await moreIdeas(getDb(), user.id, id, queue), 201);
}
