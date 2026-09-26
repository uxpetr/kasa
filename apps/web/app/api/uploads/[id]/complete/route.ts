import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { requestLog } from "@/lib/log";
import { getQueue, getStorage } from "@/lib/services";
import { completeUpload } from "@/lib/uploads";

/** POST after the PUT to storage succeeds -> { status } */
export async function POST(request: Request, { params }: RouteContext<"/api/uploads/[id]/complete">) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });

  const { id } = await params;
  const result = await completeUpload({ db: getDb(), storage: getStorage(), queue: await getQueue() }, user.id, id);
  const log = requestLog(request.headers).child({ "user.id": user.id, "upload.id": id });
  if (result.ok) log.info("upload completed", { status: result.value.status });
  else log.warn("upload completion refused", { status: result.status });
  return result.ok ? Response.json(result.value) : Response.json({ error: result.error }, { status: result.status });
}
