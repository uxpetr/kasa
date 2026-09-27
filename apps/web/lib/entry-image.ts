import { getSessionUser } from "./auth";
import { getDb } from "./db";
import { entryImageKey } from "./entries";
import { getStorage } from "./services";

/** Redirects a member to a short-lived signed URL for an entry's image. */
export async function entryImageResponse(request: Request, entryId: string, image: Parameters<typeof entryImageKey>[3]) {
  const user = await getSessionUser(request.headers);
  if (!user) return new Response(null, { status: 401 });
  const key = await entryImageKey(getDb(), user.id, entryId, image);
  if (!key) return new Response(null, { status: 404 });
  const url = await getStorage().presignDownload(key);
  // The redirect target expires in minutes, so the redirect itself must not be cached.
  return new Response(null, { status: 302, headers: { location: url, "cache-control": "private, no-store" } });
}
