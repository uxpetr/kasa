import { afterEach, describe, expect, it, vi } from "vitest";
import { setAnalyticsSink, track, type TrackedEvent } from "./analytics";

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
