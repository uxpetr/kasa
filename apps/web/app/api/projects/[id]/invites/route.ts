import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { requestLog } from "@/lib/log";
import { createInvite, currentInvite, revokeInvites, type InviteLink } from "@/lib/projects";
import { ok, toResponse, type Result } from "@/lib/result";

type Context = RouteContext<"/api/projects/[id]/invites">;

// The link people open; the page itself is P-14.
function withUrl(result: Result<InviteLink | null>, request: Request) {
  if (!result.ok || !result.value) return result;
  const base = process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
  return ok({ ...result.value, url: `${base}/invite/${result.value.token}` });
}

/** GET -> { id, token, url, expiresAt } or null: the live link. Owner only. */
export async function GET(request: Request, { params }: Context) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  return toResponse(withUrl(await currentInvite(getDb(), user.id, id), request));
}

/** POST -> 201 a new 7-day link; older links stop working (D-138). Owner only. */
export async function POST(request: Request, { params }: Context) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  const result = await createInvite(getDb(), user.id, id);
  const log = requestLog(request.headers).child({ "user.id": user.id, "project.id": id });
  if (result.ok) log.info("invite created", { "invite.id": result.value.id });
  else log.warn("invite refused", { status: result.status });
  return toResponse(withUrl(result, request), 201);
}

/** DELETE -> { revoked }: every link for the project stops working. Owner only. */
export async function DELETE(request: Request, { params }: Context) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  const result = await revokeInvites(getDb(), user.id, id);
  const log = requestLog(request.headers).child({ "user.id": user.id, "project.id": id });
  if (result.ok) log.info("invites revoked", { count: result.value.revoked });
  else log.warn("invite revoke refused", { status: result.status });
  return toResponse(result);
}
