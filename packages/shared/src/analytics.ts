// Analytics events named in PLAN.md tasks (D-129). With POSTHOG_API_KEY set they go
// server-side to PostHog EU Cloud (D-179); otherwise one JSON line per event on stdout.
// Properties carry ids and enums only, never names, emails, or message text.

export const ANALYTICS_EVENTS = [
  "signed_up",
  "signed_in",
  "project_created",
  "invite_sent",
  "invite_accepted",
  "entry_created",
  "entry_deleted",
  "reaction_added",
  "reply_created",
  // The member opened a project's feed; counts viewers as active too (P-13).
  "feed_opened",
  "feedback_sent",
  // Kasa Bot answered a tag, or didn't: `reason` is error, no_model, paused, or limited (P-17).
  "bot_answered",
  "bot_failed",
  // Kasa Bot sorted posts into categories (P-19): `sorted` entries, `first` for a pile's first sort.
  "bot_sorted",
  // A member changed categories: `action` is add, move, rename, merge, remove, or undo (P-19).
  "category_changed",
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

export const stdoutSink: AnalyticsSink = (e) => {
  console.log(JSON.stringify({ type: "analytics", ...e }));
};

export const POSTHOG_EU_HOST = "https://eu.i.posthog.com";

/**
 * PostHog's capture endpoint. No person profiles and no GeoIP: events are keyed by the user id
 * alone, which is all the pilot dashboard needs (docs/pilot-dashboard.md).
 */
export function posthogSink(config: { apiKey: string; host?: string; fetch?: typeof fetch; timeoutMs?: number }): AnalyticsSink {
  const url = `${(config.host || POSTHOG_EU_HOST).replace(/\/$/, "")}/i/v0/e/`;
  const send = config.fetch ?? fetch;
  return async (e) => {
    const res = await send(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: config.apiKey,
        event: e.event,
        distinct_id: e.userId ?? "anonymous",
        timestamp: e.at,
        properties: { ...e.properties, $process_person_profile: false, $geoip_disable: true, $lib: "kasa-server" },
      }),
      signal: AbortSignal.timeout(config.timeoutMs ?? 2000),
    });
    if (!res.ok) throw new Error(`PostHog responded ${res.status}`);
  };
}

/** PostHog when POSTHOG_API_KEY is set, stdout otherwise. */
export function sinkFromEnv(env: Record<string, string | undefined>): AnalyticsSink {
  return env.POSTHOG_API_KEY ? posthogSink({ apiKey: env.POSTHOG_API_KEY, host: env.POSTHOG_HOST }) : stdoutSink;
}

// Chosen on first use, so every bundle that imports this module (route handlers, auth hooks)
// picks the same provider from the environment without any setup call.
let sink: AnalyticsSink | undefined;

/** Replace the sink (tests). Returns a restore function. */
export function setAnalyticsSink(next: AnalyticsSink): () => void {
  const previous = sink;
  sink = next;
  return () => {
    sink = previous;
  };
}

export async function track(event: AnalyticsEvent, userId: string | null, properties: AnalyticsProperties = {}) {
  try {
    sink ??= sinkFromEnv(process.env);
    await sink({ event, userId, properties, at: new Date().toISOString() });
  } catch (error) {
    // Analytics must never break the action being tracked.
    console.error(JSON.stringify({ type: "analytics_error", event, message: String(error) }));
  }
}
