import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { setReaction } from "@/lib/entries";
import { toResponse } from "@/lib/result";

type Context = RouteContext<"/api/entries/[id]/reactions">;

async function handle(request: Request, { params }: Context, on: boolean) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "JSON body required" }, { status: 400 });
  const { id } = await params;
  return toResponse(await setReaction(getDb(), user.id, id, body, on));
}

/** PUT { emoji } adds the user's reaction -> { reactions }. Owners and editors (D-154). */
export const PUT = (request: Request, context: Context) => handle(request, context, true);
/** DELETE { emoji } removes it -> { reactions }. */
export const DELETE = (request: Request, context: Context) => handle(request, context, false);
