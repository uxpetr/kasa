import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { uploadStatus } from "@/lib/entries";
import { toResponse } from "@/lib/result";

/** GET -> { status }: pending, processing, ready, or failed. Uploader only. */
export async function GET(request: Request, { params }: RouteContext<"/api/uploads/[id]">) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  return toResponse(await uploadStatus(getDb(), user.id, id));
}
