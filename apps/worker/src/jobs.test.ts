import { context, propagation, SpanStatusCode, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { injectTraceContext } from "@kasa/observability";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runJob } from "./jobs";

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(provider);
});
afterAll(() => {
  context.disable();
  propagation.disable();
  trace.disable();
});
beforeEach(() => {
  exporter.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("runJob", () => {
  it("runs the handler in a span that continues the web request's trace", async () => {
    let carrier = {};
    let requestTrace = "";
    provider.getTracer("web").startActiveSpan("POST /api/uploads/:id/complete", (span) => {
      requestTrace = span.spanContext().traceId;
      carrier = injectTraceContext();
      span.end();
    });

    await runJob("media.process", "job-1", { uploadId: "u1", _trace: carrier }, async () => {
      expect(trace.getActiveSpan()?.spanContext().traceId).toBe(requestTrace);
    });

    const span = exporter.getFinishedSpans().find((s) => s.name === "media.process")!;
    expect(span.spanContext().traceId).toBe(requestTrace);
    expect(span.attributes).toMatchObject({ "job.name": "media.process", "job.id": "job-1" });
  });

  it("marks the span as an error and rethrows so pg-boss retries", async () => {
    await expect(
      runJob("media.process", "job-2", { uploadId: "u2" }, async () => {
        throw new Error("storage unavailable");
      }),
    ).rejects.toThrow("storage unavailable");
    const span = exporter.getFinishedSpans().find((s) => s.attributes["job.id"] === "job-2")!;
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.events.map((e) => e.name)).toContain("exception");
  });
});
