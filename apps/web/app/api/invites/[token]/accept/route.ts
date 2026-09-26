import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { requestLog } from "@/lib/log";
import { acceptInvite } from "@/lib/projects";
import { toResponse } from "@/lib/result";

/** POST -> { projectId, role }: joins as editor; members keep their role. */
export async function POST(request: Request, { params }: RouteContext<"/api/invites/[token]/accept">) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { token } = await params;
  const result = await acceptInvite(getDb(), user.id, token);
  const log = requestLog(request.headers).child({ "user.id": user.id });
  if (result.ok) log.info("invite accepted", { "project.id": result.value.projectId, role: result.value.role });
  else log.warn("invite refused", { status: result.status });
  return toResponse(result);
}
