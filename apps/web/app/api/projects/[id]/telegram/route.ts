import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { toResponse } from "@/lib/result";
import { groupLinkUrl, pileTelegram, unlinkPile } from "@/lib/telegram";

type Context = RouteContext<"/api/projects/[id]/telegram">;

/** GET -> { available, linked: { title } | null, canLink }. Members. */
export async function GET(request: Request, { params }: Context) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  return toResponse(await pileTelegram(getDb(), user.id, id));
}

/** POST -> { url }: "Add Kasa Bot to a group", a one-time t.me link (P-18). Owner only. */
export async function POST(request: Request, { params }: Context) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  return toResponse(await groupLinkUrl(getDb(), user.id, id), 201);
}

/** DELETE: unlink the group; entries stay on both sides. Owner only. */
export async function DELETE(request: Request, { params }: Context) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  return toResponse(await unlinkPile(getDb(), user.id, id));
}
