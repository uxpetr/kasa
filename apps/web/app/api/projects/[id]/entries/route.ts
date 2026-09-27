import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { createEntry, listEntries } from "@/lib/entries";
import { requestLog } from "@/lib/log";
import { toResponse } from "@/lib/result";

type Context = RouteContext<"/api/projects/[id]/entries">;

/** GET ?before=<cursor> -> { entries (oldest first), nextCursor }. Members only. */
export async function GET(request: Request, { params }: Context) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  const before = new URL(request.url).searchParams.get("before") ?? undefined;
  return toResponse(await listEntries(getDb(), user.id, id, { before }));
}

/** POST { text?, uploadIds? } -> 201 entry. Owners and editors, not while archived. */
export async function POST(request: Request, { params }: Context) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "JSON body required" }, { status: 400 });

  const { id } = await params;
  const result = await createEntry(getDb(), user.id, id, body);
  const log = requestLog(request.headers).child({ "user.id": user.id, "project.id": id });
  if (result.ok) log.info("entry created", { "entry.id": result.value.id, kind: result.value.kind });
  else log.warn("entry refused", { status: result.status });
  return toResponse(result, 201);
}
