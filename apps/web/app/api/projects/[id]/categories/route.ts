import { canRead, projectAccess } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { createCategory, listCategories } from "@/lib/categories";
import { getDb } from "@/lib/db";
import { isUuid, toResponse } from "@/lib/result";

type Context = RouteContext<"/api/projects/[id]/categories">;

/** GET -> [{ id, name, count }]: the pile's categories in chip order (P-19). Members only. */
export async function GET(request: Request, { params }: Context) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  const access = isUuid(id) ? await projectAccess(getDb(), user.id, id) : null;
  if (!canRead(access)) return Response.json({ error: "Project not found" }, { status: 404 });
  return Response.json(await listCategories(getDb(), id));
}

/** POST { name } -> 201 { id, name }: a member adds a category (D-201). Owners and editors. */
export async function POST(request: Request, { params }: Context) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "JSON body required" }, { status: 400 });
  const { id } = await params;
  return toResponse(await createCategory(getDb(), user.id, id, body), 201);
}
