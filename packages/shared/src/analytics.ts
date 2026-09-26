// Analytics events named in PLAN.md tasks. The provider is not chosen yet (OD-11):
// until then events go to a sink that writes one JSON line per event to stdout.
// Properties carry ids and enums only, never names, emails, or message text.

export const ANALYTICS_EVENTS = [
  "signed_up",
  "signed_in",
  "project_created",
  "invite_sent",
  "invite_accepted",
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

export type AnalyticsProperties = Record<string, string | number | boolean | null>;

export interface TrackedEvent {
  event: AnalyticsEvent;
  userId: string | null;
  properties: AnalyticsProperties;
  at: string;
}

export type AnalyticsSink = (event: TrackedEvent) => void | Promise<void>;

const stdoutSink: AnalyticsSink = (e) => {
  console.log(JSON.stringify({ type: "analytics", ...e }));
};

let sink: AnalyticsSink = stdoutSink;

/** Replace the sink (tests, or the real provider once OD-11 is answered). Returns a restore function. */
export function setAnalyticsSink(next: AnalyticsSink): () => void {
  const previous = sink;
  sink = next;
  return () => {
    sink = previous;
  };
}

export async function track(event: AnalyticsEvent, userId: string | null, properties: AnalyticsProperties = {}) {
  try {
    await sink({ event, userId, properties, at: new Date().toISOString() });
  } catch (error) {
    // Analytics must never break the action being tracked.
    console.error(JSON.stringify({ type: "analytics_error", event, message: String(error) }));
  }
}
