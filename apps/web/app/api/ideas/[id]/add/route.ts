import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { addIdea } from "@/lib/ideas";
import { requestLog } from "@/lib/log";
import { toResponse } from "@/lib/result";
import { getQueue } from "@/lib/services";

/** POST on a Kasa Bot idea: "Add to pile" posts it as the member's link (D-204). Owners and editors. */
export async function POST(request: Request, { params }: RouteContext<"/api/ideas/[id]/add">) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  // Without the queue the link is still added; it just isn't sorted.
  const queue = await getQueue().catch((error: unknown) => {
    requestLog(request.headers).error("queue unavailable", { message: error instanceof Error ? error.message : String(error) });
    return undefined;
  });
  return toResponse(await addIdea(getDb(), user.id, id, queue), 201);
}
