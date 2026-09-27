import { entryImageResponse } from "@/lib/entry-image";

/** GET -> redirect to a capture screenshot or other entry image, members only. */
export async function GET(request: Request, { params }: RouteContext<"/api/entries/[id]/media/[mediaId]">) {
  const { id, mediaId } = await params;
  return entryImageResponse(request, id, { mediaId });
}
