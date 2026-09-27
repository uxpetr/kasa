// Unsubscribe links (P-12, D-165): the worker signs one per person and project for every
// email; the web app verifies it and mutes that project without a sign-in. They don't
// expire, like any unsubscribe link. Server-only (node:crypto).
import { createHmac, timingSafeEqual } from "node:crypto";

export interface UnsubscribeClaims {
  projectId: string;
  userId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Domain-separated, so a token can't be confused with anything else signed by the same secret.
const sign = (secret: string, projectId: string, userId: string) =>
  createHmac("sha256", secret).update(`kasa-unsubscribe:${projectId}:${userId}`).digest().subarray(0, 18);

/** `<projectId>.<userId>.<signature>`, URL-safe. */
export function createUnsubscribeToken(secret: string, claims: UnsubscribeClaims): string {
  if (!secret) throw new Error("UNSUBSCRIBE_SECRET is not set. See .env.example.");
  return `${claims.projectId}.${claims.userId}.${sign(secret, claims.projectId, claims.userId).toString("base64url")}`;
}

export function verifyUnsubscribeToken(secret: string | undefined, token: unknown): UnsubscribeClaims | null {
  if (!secret || typeof token !== "string" || token.length > 200) return null;
  const [projectId, userId, signature, extra] = token.split(".");
  if (!projectId || !userId || !signature || extra !== undefined || !UUID.test(projectId) || !UUID.test(userId)) return null;
  // Compare the encoded strings: decoding would quietly ignore trailing junk.
  const expected = Buffer.from(sign(secret, projectId, userId).toString("base64url"));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return { projectId, userId };
}
