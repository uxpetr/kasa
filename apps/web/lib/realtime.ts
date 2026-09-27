// Realtime tickets (P-06): members get a short-lived ticket for one project's updates.
import type { Database } from "@kasa/db";
import { createTicket } from "@kasa/shared/realtime";
import { canRead, projectAccess } from "./access";
import { fail, isUuid, ok, type Result } from "./result";

export interface RealtimeConfig {
  secret: string;
  /** WebSocket URL the browser connects to. */
  url: string;
}

/** Null when realtime isn't set up (the feed then works without live updates). */
export function realtimeConfig(env: Record<string, string | undefined> = process.env): RealtimeConfig | null {
  const secret = env.REALTIME_SECRET;
  const url = env.REALTIME_PUBLIC_URL;
  return secret && url ? { secret, url } : null;
}

export async function realtimeTicket(
  db: Database,
  config: RealtimeConfig | null,
  userId: string,
  projectId: string,
): Promise<Result<{ url: string; ticket: string }>> {
  const access = isUuid(projectId) ? await projectAccess(db, userId, projectId) : null;
  if (!canRead(access)) return fail(404, "Project not found");
  if (!config) return fail(503, "Live updates aren't set up");
  return ok({ url: config.url, ticket: createTicket(config.secret, { projectId, userId }) });
}
