import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { realtimeConfig, realtimeTicket } from "@/lib/realtime";
import { toResponse } from "@/lib/result";

/** POST -> { url, ticket } for this project's live updates. Members only; 503 when not set up. */
export async function POST(request: Request, { params }: RouteContext<"/api/projects/[id]/realtime">) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  const result = await realtimeTicket(getDb(), realtimeConfig(), user.id, id);
  // Tickets are single-purpose and short-lived; never cache them.
  const response = toResponse(result);
  response.headers.set("cache-control", "no-store");
  return response;
}
