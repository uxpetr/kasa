import { context, propagation, type Context } from "@opentelemetry/api";

/** W3C trace context carried inside a job payload, so a job continues the request's trace. */
export type TraceCarrier = Record<string, string>;

export function injectTraceContext(): TraceCarrier {
  const carrier: TraceCarrier = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

export function extractTraceContext(carrier: TraceCarrier | undefined): Context {
  return carrier ? propagation.extract(context.active(), carrier) : context.active();
}
