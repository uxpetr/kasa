// Realtime tickets (P-06): the web app checks membership and signs a short-lived ticket for
// one project; the realtime service only verifies the signature. Server-only (node:crypto).
import { createHmac, timingSafeEqual } from "node:crypto";

/** A ticket is only good for opening a connection, so it can be short. */
export const TICKET_TTL_SECONDS = 60;

export interface TicketClaims {
  projectId: string;
  userId: string;
}

/** The message the realtime service sends when something in the project changed. */
export interface ChangedMessage {
  type: "changed";
  projectId: string;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const sign = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest();

export function createTicket(secret: string, claims: TicketClaims, now = Date.now()): string {
  if (!secret) throw new Error("REALTIME_SECRET is not set. See .env.example.");
  const payload = b64(JSON.stringify({ p: claims.projectId, u: claims.userId, exp: Math.floor(now / 1000) + TICKET_TTL_SECONDS }));
  return `${payload}.${b64(sign(secret, payload))}`;
}

/** The claims of a valid, unexpired ticket, or null. */
export function verifyTicket(secret: string, ticket: unknown, now = Date.now()): TicketClaims | null {
  if (!secret || typeof ticket !== "string" || ticket.length > 1024) return null;
  const [payload, signature, extra] = ticket.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = sign(secret, payload);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { p, u, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { p?: unknown; u?: unknown; exp?: unknown };
    if (typeof p !== "string" || typeof u !== "string" || typeof exp !== "number") return null;
    return exp * 1000 > now ? { projectId: p, userId: u } : null;
  } catch {
    return null;
  }
}
