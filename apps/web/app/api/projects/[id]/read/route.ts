import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { markRead } from "@/lib/entries";
import { toResponse } from "@/lib/result";

/** POST -> { ok }: the member has seen the feed up to now (D-147). `?opened=1` when the feed first opens. */
export async function POST(request: Request, { params }: RouteContext<"/api/projects/[id]/read">) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  return toResponse(await markRead(getDb(), user.id, id, new URL(request.url).searchParams.get("opened") === "1"));
}
