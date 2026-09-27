import { entryImageResponse } from "@/lib/entry-image";

/** GET -> redirect to a link entry's preview image (re-hosted by P-05), members only. */
export async function GET(request: Request, { params }: RouteContext<"/api/entries/[id]/preview-image">) {
  const { id } = await params;
  return entryImageResponse(request, id, "preview");
}
