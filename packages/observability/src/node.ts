// OpenTelemetry for long-running Node services (worker, realtime). The web app uses
// @vercel/otel instead so spans flush before a serverless function freezes.
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { NodeSDK } from "@opentelemetry/sdk-node";

/**
 * Starts tracing and log export when OTEL_EXPORTER_OTLP_ENDPOINT is set (D-137).
 * Endpoint, auth headers, and resource attributes come from the standard OTEL_* env vars.
 */
export function startNodeTelemetry(serviceName: string): { shutdown: () => Promise<void> } {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_SDK_DISABLED === "true") {
    return { shutdown: async () => {} };
  }
  const sdk = new NodeSDK({
    // serviceName (not a resource attribute) so OTEL_SERVICE_NAME can't merge services together.
    serviceName,
    traceExporter: new OTLPTraceExporter(),
    logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
    // Outgoing HTTP (S3, APIs) and pg (used by pg-boss). postgres.js has no instrumentation yet.
    instrumentations: [new HttpInstrumentation(), new UndiciInstrumentation(), new PgInstrumentation()],
  });
  sdk.start();
  return { shutdown: () => sdk.shutdown() };
}
