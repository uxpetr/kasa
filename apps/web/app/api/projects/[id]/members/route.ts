import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listMembers } from "@/lib/projects";
import { toResponse } from "@/lib/result";

/** GET -> { members: [{ id, name, role }] }. Members only. */
export async function GET(request: Request, { params }: RouteContext<"/api/projects/[id]/members">) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  return toResponse(await listMembers(getDb(), user.id, id));
}
