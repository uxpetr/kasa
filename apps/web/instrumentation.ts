// OpenTelemetry for the web app (F-07, D-137). @vercel/otel exports traces to the
// OTEL_EXPORTER_OTLP_* endpoint (personal Dash0, D-136) and flushes before functions freeze.
import type { Instrumentation } from "next";
import { registerOTel } from "@vercel/otel";

export async function register() {
  const exporting = Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
  const logRecordProcessors = [];
  if (exporting && process.env.NEXT_RUNTIME === "nodejs") {
    const { BatchLogRecordProcessor } = await import("@opentelemetry/sdk-logs");
    const { OTLPLogExporter } = await import("@opentelemetry/exporter-logs-otlp-proto");
    logRecordProcessors.push(new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() }));
  }
  // Each service names itself; @vercel/otel would let OTEL_SERVICE_NAME rename web to match the others.
  delete process.env.OTEL_SERVICE_NAME;
  registerOTel({ serviceName: "kasa-web", logRecordProcessors });
}

/** Server errors: logged with the route and request id; the active span records the exception. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { log } = await import("./lib/log");
  const { errorAttributes } = await import("@kasa/observability");
  const headers = request.headers as Record<string, string | string[] | undefined>;
  log.error("request failed", {
    ...errorAttributes(error),
    digest: typeof error === "object" && error && "digest" in error ? String(error.digest) : undefined,
    request_id: typeof headers["x-request-id"] === "string" ? headers["x-request-id"] : undefined,
    "http.method": request.method,
    "http.route": context.routePath,
    "next.route_type": context.routeType,
  });
};
