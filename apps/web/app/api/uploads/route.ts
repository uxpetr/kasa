import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getStorage } from "@/lib/services";
import { createUpload } from "@/lib/uploads";

/** POST { projectId, contentType, size } -> { uploadId, uploadUrl, headers } */
export async function POST(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "JSON body required" }, { status: 400 });

  const result = await createUpload({ db: getDb(), storage: getStorage() }, user.id, body);
  return result.ok
    ? Response.json(result.value, { status: 201 })
    : Response.json({ error: result.error }, { status: result.status });
}
