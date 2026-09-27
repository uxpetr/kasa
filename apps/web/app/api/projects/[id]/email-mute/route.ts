import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { setEmailsMuted } from "@/lib/notifications";
import { toResponse } from "@/lib/result";

type Context = RouteContext<"/api/projects/[id]/email-mute">;

/** PUT { muted } -> { muted }. "Mute emails" / "Unmute emails" in the project menu (D-165). Any member. */
export async function PUT(request: Request, { params }: Context) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { muted?: unknown } | null;
  const { id } = await params;
  return toResponse(await setEmailsMuted(getDb(), user.id, id, body?.muted));
}
