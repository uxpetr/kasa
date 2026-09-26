export type FailStatus = 400 | 403 | 404 | 409 | 410 | 413 | 415;

export type Result<T> = { ok: true; value: T } | { ok: false; status: FailStatus; error: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T>(status: FailStatus, error: string): Result<T> => ({ ok: false, status, error });

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** The JSON response for a result: `status` on success, the failure's own status otherwise. */
export function toResponse<T>(result: Result<T>, status = 200): Response {
  return result.ok ? Response.json(result.value, { status }) : Response.json({ error: result.error }, { status: result.status });
}
