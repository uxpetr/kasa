import { entryImageResponse } from "@/lib/entry-image";

/** GET -> redirect to a Kasa Bot idea's picture (P-20), members only. */
export async function GET(request: Request, { params }: RouteContext<"/api/entries/[id]/ideas/[ideaId]/image">) {
  const { id, ideaId } = await params;
  return entryImageResponse(request, id, { ideaId });
}
