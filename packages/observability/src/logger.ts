import { trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { redact } from "./redact";

type Level = "debug" | "info" | "warn" | "error";

const severity: Record<Level, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

export interface Logger {
  debug(msg: string, attributes?: Record<string, unknown>): void;
  info(msg: string, attributes?: Record<string, unknown>): void;
  warn(msg: string, attributes?: Record<string, unknown>): void;
  error(msg: string, attributes?: Record<string, unknown>): void;
  /** A logger whose lines all carry these attributes, e.g. a request id. */
  child(attributes: Record<string, unknown>): Logger;
}

export type LogSink = (line: string) => void;

/**
 * Structured logs: one JSON line on stdout (read by the host's log drain) and the same
 * record through OpenTelemetry, which exports it to Dash0 with the trace attached.
 * Messages must be constant strings; variable data goes in attributes, which are redacted.
 */
export function createLogger(service: string, bound: Record<string, unknown> = {}, sink: LogSink = console.log): Logger {
  const otel = logs.getLogger(service);
  const write = (level: Level, msg: string, attributes: Record<string, unknown> = {}) => {
    const attrs = redact({ ...bound, ...attributes });
    const span = trace.getActiveSpan()?.spanContext();
    sink(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        service,
        msg,
        ...(span ? { trace_id: span.traceId, span_id: span.spanId } : {}),
        ...attrs,
      }),
    );
    otel.emit({ severityNumber: severity[level], severityText: level.toUpperCase(), body: msg, attributes: attrs });
  };
  return {
    debug: (m, a) => write("debug", m, a),
    info: (m, a) => write("info", m, a),
    warn: (m, a) => write("warn", m, a),
    error: (m, a) => write("error", m, a),
    child: (a) => createLogger(service, { ...bound, ...a }, sink),
  };
}

/** Error details safe to log: type and message, never the object itself. */
export function errorAttributes(error: unknown): Record<string, string> {
  if (error instanceof Error) return { "exception.type": error.name, "exception.message": error.message.slice(0, 500) };
  return { "exception.type": typeof error };
}
