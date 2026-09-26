import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { requestLog } from "@/lib/log";
import { getStorage } from "@/lib/services";
import { createUpload } from "@/lib/uploads";

/** POST { projectId, contentType, size } -> { uploadId, uploadUrl, headers } */
export async function POST(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "JSON body required" }, { status: 400 });

  const result = await createUpload({ db: getDb(), storage: getStorage() }, user.id, body);
  const log = requestLog(request.headers).child({ "user.id": user.id, "project.id": body.projectId });
  if (result.ok) log.info("upload created", { "upload.id": result.value.uploadId, size: body.size, content_type: body.contentType });
  else log.warn("upload refused", { status: result.status });
  return result.ok
    ? Response.json(result.value, { status: 201 })
    : Response.json({ error: result.error }, { status: result.status });
}
