// Runtime-neutral pieces: logger, redaction, trace propagation. The Node SDK setup is in "./node".
export { createLogger, errorAttributes, type Logger, type LogSink } from "./logger";
export { extractTraceContext, injectTraceContext, type TraceCarrier } from "./propagation";
export { isSensitiveKey, redact, REDACTED } from "./redact";
