import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { requestLog } from "@/lib/log";
import { updateProject } from "@/lib/projects";
import { toResponse } from "@/lib/result";

/** PATCH { name?, archived? } -> project. Rename: owner or editor. Archive/unarchive: owner. */
export async function PATCH(request: Request, { params }: RouteContext<"/api/projects/[id]">) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "JSON body required" }, { status: 400 });

  const { id } = await params;
  const result = await updateProject(getDb(), user.id, id, body);
  const log = requestLog(request.headers).child({ "user.id": user.id, "project.id": id });
  if (result.ok) log.info("project updated", { renamed: body.name !== undefined, archived: result.value.archivedAt !== null });
  else log.warn("project update refused", { status: result.status });
  return toResponse(result);
}
