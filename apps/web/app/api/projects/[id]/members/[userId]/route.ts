import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { requestLog } from "@/lib/log";
import { changeRole, removeMember } from "@/lib/projects";
import { toResponse } from "@/lib/result";

type Context = RouteContext<"/api/projects/[id]/members/[userId]">;

/** PATCH { role: "editor" | "viewer" } -> { id, role }. Owner only, not while archived (D-169). */
export async function PATCH(request: Request, { params }: Context) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { role?: unknown } | null;
  const { id, userId } = await params;
  return toResponse(await changeRole(getDb(), user.id, id, userId, body?.role));
}

/** DELETE -> { removed }. The owner removes a member; anyone but the owner removes themselves to leave (D-169). */
export async function DELETE(request: Request, { params }: Context) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id, userId } = await params;
  const result = await removeMember(getDb(), user.id, id, userId);
  const log = requestLog(request.headers).child({ "user.id": user.id, "project.id": id });
  if (result.ok) log.info(userId === user.id ? "member left" : "member removed", { "member.id": userId });
  else log.warn("member change refused", { status: result.status });
  return toResponse(result);
}
