import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import type { JobData, JobName } from "@kasa/jobs";
import { createLogger, errorAttributes, extractTraceContext } from "@kasa/observability";

export const log = createLogger("kasa-worker");
const tracer = trace.getTracer("kasa-worker");

/** Runs one job in a span that continues the sender's trace, and logs how it went. */
export async function runJob<N extends JobName>(name: N, jobId: string, data: JobData<N>, handler: () => Promise<void>) {
  const started = performance.now();
  await context.with(extractTraceContext(data._trace), () =>
    tracer.startActiveSpan(name, { attributes: { "job.name": name, "job.id": jobId } }, async (span) => {
      try {
        await handler();
        log.info("job done", { job: name, "job.id": jobId, duration_ms: Math.round(performance.now() - started) });
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        log.error("job failed", { job: name, "job.id": jobId, ...errorAttributes(error) });
        throw error;
      } finally {
        span.end();
      }
    }),
  );
}
