import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getStorage } from "@/lib/services";
import { mediaUrl } from "@/lib/uploads";

/** GET /api/media/<uploadId>/<full|thumb> -> redirect to a short-lived signed URL, members only. */
export async function GET(request: Request, { params }: RouteContext<"/api/media/[id]/[variant]">) {
  const user = await getSessionUser(request.headers);
  if (!user) return new Response(null, { status: 401 });

  const { id, variant } = await params;
  if (variant !== "full" && variant !== "thumb") return new Response(null, { status: 404 });

  const url = await mediaUrl({ db: getDb(), storage: getStorage() }, user.id, id, variant);
  if (!url) return new Response(null, { status: 404 });
  // The redirect target expires in minutes, so the redirect itself must not be cached.
  return new Response(null, { status: 302, headers: { location: url, "cache-control": "private, no-store" } });
}
