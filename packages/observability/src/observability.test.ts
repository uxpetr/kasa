import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger, errorAttributes, extractTraceContext, injectTraceContext, isSensitiveKey, redact, REDACTED } from "./index";

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
const tracer = provider.getTracer("test");

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

describe("redact", () => {
  it.each(["email", "userEmail", "name", "displayName", "body", "noteText", "caption", "authorization", "cookie", "token", "sessionToken", "ip", "message"])(
    "hides %s",
    (key) => {
      expect(isSensitiveKey(key)).toBe(true);
      expect(redact({ [key]: "secret stuff" })[key]).toBe(REDACTED);
    },
  );

  it.each(["user.id", "project_id", "upload.id", "request_id", "status", "size", "content_type", "job", "duration_ms", "entry.kind", "msg"])(
    "keeps %s",
    (key) => {
      expect(redact({ [key]: "value" })[key]).toBe("value");
    },
  );

  it("never logs nested objects, only their shape", () => {
    expect(redact({ payload: { email: "a@b.c" }, list: [1, 2, 3] })).toEqual({ payload: "[object]", list: "[array(3)]" });
  });
});

describe("createLogger", () => {
  const capture = () => {
    const lines: Record<string, unknown>[] = [];
    return { lines, sink: (l: string) => lines.push(JSON.parse(l)) };
  };

  it("writes one JSON line with level, service, and redacted attributes", () => {
    const { lines, sink } = capture();
    createLogger("kasa-test", {}, sink).info("upload created", { "upload.id": "u1", email: "petr@example.com" });
    expect(lines).toEqual([
      expect.objectContaining({ level: "info", service: "kasa-test", msg: "upload created", "upload.id": "u1", email: REDACTED }),
    ]);
    expect(JSON.stringify(lines)).not.toContain("petr@example.com");
  });

  it("carries the active trace and span ids", () => {
    const { lines, sink } = capture();
    const log = createLogger("kasa-test", {}, sink);
    tracer.startActiveSpan("request", (span) => {
      log.info("inside");
      span.end();
      expect(lines[0]).toMatchObject({ trace_id: span.spanContext().traceId, span_id: span.spanContext().spanId });
    });
  });

  it("child loggers keep bound attributes such as the request id", () => {
    const { lines, sink } = capture();
    createLogger("kasa-test", {}, sink).child({ request_id: "req-1" }).warn("slow");
    expect(lines[0]).toMatchObject({ request_id: "req-1", level: "warn" });
  });

  it("summarizes errors without the object", () => {
    expect(errorAttributes(new TypeError("bad input"))).toEqual({ "exception.type": "TypeError", "exception.message": "bad input" });
    expect(errorAttributes("oops")).toEqual({ "exception.type": "string" });
  });
});

describe("trace propagation through job payloads", () => {
  it("continues the sender's trace in the job", () => {
    exporter.reset();
    let carrier: Record<string, string> = {};
    let sender = "";
    tracer.startActiveSpan("POST /api/uploads/:id/complete", (span) => {
      sender = span.spanContext().traceId;
      carrier = injectTraceContext();
      span.end();
    });
    expect(carrier.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);

    context.with(extractTraceContext(carrier), () => {
      tracer.startActiveSpan("media.process", (span) => span.end());
    });
    const job = exporter.getFinishedSpans().find((s) => s.name === "media.process")!;
    expect(job.spanContext().traceId).toBe(sender);
  });

  it("starts a fresh trace when the payload has none", () => {
    expect(extractTraceContext(undefined)).toBe(context.active());
  });
});
