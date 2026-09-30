import { getSessionUser } from "@/lib/auth";
import { undoReceipt } from "@/lib/categories";
import { getDb } from "@/lib/db";
import { toResponse } from "@/lib/result";

/** POST on a sorting receipt: Undo takes back that burst's sorting (D-201). Owners and editors. */
export async function POST(request: Request, { params }: RouteContext<"/api/entries/[id]/undo">) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  return toResponse(await undoReceipt(getDb(), user.id, id));
}
