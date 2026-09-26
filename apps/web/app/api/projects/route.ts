import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { requestLog } from "@/lib/log";
import { createProject, listProjects } from "@/lib/projects";
import { toResponse } from "@/lib/result";

/** GET -> { projects: [...] }: the signed-in user's projects, archived ones flagged. */
export async function GET(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  return Response.json({ projects: await listProjects(getDb(), user.id) });
}

/** POST { name } -> 201 project, with the caller as owner. */
export async function POST(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "JSON body required" }, { status: 400 });

  const result = await createProject(getDb(), user.id, body);
  const log = requestLog(request.headers).child({ "user.id": user.id });
  if (result.ok) log.info("project created", { "project.id": result.value.id });
  else log.warn("project creation refused", { status: result.status });
  return toResponse(result, 201);
}
