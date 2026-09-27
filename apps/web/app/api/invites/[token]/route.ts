import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { previewInvite } from "@/lib/projects";
import { toResponse } from "@/lib/result";

/**
 * GET -> { projectId, projectName, memberCount, inviterName, avatars, alreadyMember }.
 * Works signed out too, for the invite page (D-174). 404 unknown, 410 once the link stops working.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/invites/[token]">) {
  const user = await getSessionUser(request.headers);
  const { token } = await params;
  const result = await previewInvite(getDb(), user?.id ?? null, token);
  // Signed out, only what the page shows (D-174).
  if (result.ok && !user) {
    const { projectName, memberCount, inviterName, avatars, alreadyMember } = result.value;
    return Response.json({ projectName, memberCount, inviterName, avatars, alreadyMember });
  }
  return toResponse(result);
}
