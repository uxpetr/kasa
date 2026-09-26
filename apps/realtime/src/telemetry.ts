// Preloaded with --import so tracing is set up before any instrumented module loads.
import "@kasa/observability/register";
import { startNodeTelemetry } from "@kasa/observability/node";

const telemetry = startNodeTelemetry("kasa-realtime");
process.once("beforeExit", () => void telemetry.shutdown());
export { telemetry };
