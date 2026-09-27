import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { deleteEntry } from "@/lib/entries";
import { requestLog } from "@/lib/log";
import { toResponse } from "@/lib/result";

/** DELETE -> the entry as an outline (D-155). The author, or the project owner (D-015). */
export async function DELETE(request: Request, { params }: RouteContext<"/api/entries/[id]">) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  const result = await deleteEntry(getDb(), user.id, id);
  const log = requestLog(request.headers).child({ "user.id": user.id, "entry.id": id });
  if (result.ok) log.info("entry deleted");
  else log.warn("entry delete refused", { status: result.status });
  return toResponse(result);
}
