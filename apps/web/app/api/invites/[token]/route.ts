import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { previewInvite } from "@/lib/projects";
import { toResponse } from "@/lib/result";

/** GET -> { projectId, projectName, memberCount, alreadyMember }. 410 once the link stops working. */
export async function GET(request: Request, { params }: RouteContext<"/api/invites/[token]">) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { token } = await params;
  return toResponse(await previewInvite(getDb(), user.id, token));
}
