import { afterEach, describe, expect, it, vi } from "vitest";
import { posthogSink, setAnalyticsSink, sinkFromEnv, stdoutSink, track, type TrackedEvent } from "./analytics";

describe("track", () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  it("sends the event to the current sink", async () => {
    const events: TrackedEvent[] = [];
    restore = setAnalyticsSink((e) => {
      events.push(e);
    });
    await track("signed_in", "user-1", { method: "google" });
    expect(events).toEqual([
      { event: "signed_in", userId: "user-1", properties: { method: "google" }, at: expect.any(String) },
    ]);
  });

  it("swallows sink failures", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    restore = setAnalyticsSink(() => {
      throw new Error("down");
    });
    await expect(track("signed_up", "user-1")).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});

describe("posthogSink", () => {
  const event: TrackedEvent = { event: "entry_created", userId: "user-1", properties: { projectId: "p1", kind: "link" }, at: "2026-09-27T10:00:00.000Z" };

  it("posts to the EU capture endpoint, keyed by user id, without person profiles", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await posthogSink({ apiKey: "phc_test", fetch: fake })(event);
    expect(calls).toEqual([
      {
        url: "https://eu.i.posthog.com/i/v0/e/",
        body: {
          api_key: "phc_test",
          event: "entry_created",
          distinct_id: "user-1",
          timestamp: "2026-09-27T10:00:00.000Z",
          properties: { projectId: "p1", kind: "link", $process_person_profile: false, $geoip_disable: true, $lib: "kasa-server" },
        },
      },
    ]);
  });

  it("uses another host when given, and fails on an error status", async () => {
    let seen = "";
    const fake = (async (url: string) => {
      seen = url;
      return new Response("", { status: 401 });
    }) as typeof fetch;
    await expect(posthogSink({ apiKey: "k", host: "https://ph.example.com/", fetch: fake })(event)).rejects.toThrow("401");
    expect(seen).toBe("https://ph.example.com/i/v0/e/");
  });

  it("is chosen only when a key is set", () => {
    expect(sinkFromEnv({})).toBe(stdoutSink);
    expect(sinkFromEnv({ POSTHOG_API_KEY: "k" })).not.toBe(stdoutSink);
  });
});
