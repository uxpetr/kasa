// Logs and span attributes never carry personal data or message bodies (F-07).
// Keys that look like they might are replaced; ids, counts, and enums pass through.

const SENSITIVE_KEY = /(e-?mail|name|body|text|content|caption|note|comment|message|token|secret|password|passwd|authorization|cookie|session|phone|address|ip)/i;
// Ids and a few known-safe keys stay even when they contain a word above.
const SAFE_KEY = /(^|[._])(id|ids|count|status|kind|role|size|type|variant|code|reason|source|event|job|queue|duration_ms)$|^(msg|service|level|request_id|trace_id|span_id|content_type|http\.status_code)$/i;

export const REDACTED = "[redacted]";

export type LogValue = string | number | boolean | null | undefined;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key) && !SAFE_KEY.test(key);
}

export function redact(attributes: Record<string, unknown>): Record<string, LogValue> {
  const out: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (isSensitiveKey(key)) out[key] = REDACTED;
    else if (value === null || value === undefined || ["string", "number", "boolean"].includes(typeof value)) {
      out[key] = value as LogValue;
    } else {
      // Nested objects can hide anything; log only their shape.
      out[key] = Array.isArray(value) ? `[array(${value.length})]` : "[object]";
    }
  }
  return out;
}
