import { getSessionUser } from "@/lib/auth";
import { deleteCategory, updateCategory } from "@/lib/categories";
import { getDb } from "@/lib/db";
import { toResponse } from "@/lib/result";

type Context = RouteContext<"/api/categories/[id]">;

/** PATCH { name } renames; PATCH { mergeInto } merges into another category -> { id, name } (P-19). */
export async function PATCH(request: Request, { params }: Context) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "JSON body required" }, { status: 400 });
  const { id } = await params;
  return toResponse(await updateCategory(getDb(), user.id, id, body));
}

/** DELETE removes the category; its entries stay, uncategorized. */
export async function DELETE(request: Request, { params }: Context) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  return toResponse(await deleteCategory(getDb(), user.id, id));
}
