import { getSessionUser } from "@/lib/auth";
import { setEntryCategories } from "@/lib/categories";
import { getDb } from "@/lib/db";
import { toResponse } from "@/lib/result";

/** PUT { categoryIds } sets a post's categories -> { categories } (P-19). Owners and editors. */
export async function PUT(request: Request, { params }: RouteContext<"/api/entries/[id]/categories">) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "JSON body required" }, { status: 400 });
  const { id } = await params;
  return toResponse(await setEntryCategories(getDb(), user.id, id, body));
}
