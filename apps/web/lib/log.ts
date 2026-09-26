import { createLogger, type Logger } from "@kasa/observability";
import { trace } from "@opentelemetry/api";

export const log = createLogger("kasa-web");

export const REQUEST_ID_HEADER = "x-request-id";

/** A logger bound to this request's id, which proxy.ts sets on every request. */
export function requestLog(headers: Headers): Logger {
  const requestId = headers.get(REQUEST_ID_HEADER) ?? undefined;
  if (requestId) trace.getActiveSpan()?.setAttribute("kasa.request_id", requestId);
  return log.child({ request_id: requestId });
}
