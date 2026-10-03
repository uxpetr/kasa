import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { toResponse } from "@/lib/result";
import { accountLinkUrl, accountTelegram, unlinkAccount } from "@/lib/telegram";

/** GET -> { available, linked }: the signed-in person's Telegram account (P-18). */
export async function GET(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  return Response.json(await accountTelegram(getDb(), user.id));
}

/** POST -> { url }: "Link Telegram", a one-time t.me link to the bot. */
export async function POST(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  return toResponse(await accountLinkUrl(getDb(), user.id), 201);
}

/** DELETE: unlink; their group messages then land as a guest's. */
export async function DELETE(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  await unlinkAccount(getDb(), user.id);
  return Response.json({ ok: true });
}
