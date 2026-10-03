import { describe, expect, it, vi } from "vitest";
import type { FeedEntry } from "./entries";
import { connectLive, mergeChanges } from "./live";

const entry = (id: string, minute: number, body = id): FeedEntry => ({
  id,
  kind: "note",
  body,
  botCard: null,
  botEntriesRead: null,
  createdAt: new Date(Date.UTC(2026, 8, 27, 9, minute)).toISOString(),
  author: null,
  deleted: false,
  deletedBy: null,
  photos: [],
  link: null,
  capture: null,
  reactions: [],
  replyTo: null,
  categories: [],
  receipt: null,
  ideas: [],
  fromBot: false,
  source: "app",
  guest: null,
});

describe("mergeChanges", () => {
  const loaded = [entry("b", 10), entry("c", 20)];

  it("replaces shown entries and appends new ones in order", () => {
    const merged = mergeChanges(loaded, [entry("d", 30), entry("b", 10, "b edited")], { complete: false });
    expect(merged.map((e) => [e.id, e.body])).toEqual([
      ["b", "b edited"],
      ["c", "c"],
      ["d", "d"],
    ]);
  });

  it("leaves out changes to entries older than the loaded page, unless it's the whole feed", () => {
    expect(mergeChanges(loaded, [entry("a", 5)], { complete: false }).map((e) => e.id)).toEqual(["b", "c"]);
    expect(mergeChanges(loaded, [entry("a", 5)], { complete: true }).map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(mergeChanges([], [entry("a", 5)], { complete: false }).map((e) => e.id)).toEqual(["a"]);
  });

  it("is idempotent, since changes can repeat", () => {
    const once = mergeChanges(loaded, [entry("d", 30)], { complete: false });
    expect(mergeChanges(once, [entry("d", 30)], { complete: false })).toHaveLength(3);
  });
});

describe("connectLive", () => {
  function fakes(statuses: number[] = []) {
    type Fake = { url: string; onmessage: ((e: { data: unknown }) => void) | null; onclose: (() => void) | null; close: () => void; closed: boolean };
    const sockets: Fake[] = [];
    const fetch = vi.fn(async () => {
      const status = statuses.shift() ?? 200;
      return new Response(status === 200 ? JSON.stringify({ url: "ws://rt", ticket: "t k" }) : "{}", { status });
    });
    const createSocket = (url: string) => {
      const s: Fake = { url, onmessage: null, onclose: null, closed: false, close: () => void (s.closed = true) };
      sockets.push(s);
      return s as never;
    };
    return { sockets, fetch, createSocket };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("connects with a fresh ticket, catches up on ready, and pulls on every change", async () => {
    const { sockets, fetch, createSocket } = fakes();
    const onChange = vi.fn();
    const live = connectLive({ projectId: "p1", onChange, fetch, createSocket, delay: () => 0 });
    await flush();
    expect(fetch).toHaveBeenCalledWith("/api/projects/p1/realtime", { method: "POST" });
    expect(sockets[0]!.url).toBe("ws://rt?ticket=t%20k");
    sockets[0]!.onmessage!({ data: '{"type":"ready"}' });
    sockets[0]!.onmessage!({ data: '{"type":"changed","projectId":"p1"}' });
    sockets[0]!.onmessage!({ data: "junk" });
    expect(onChange).toHaveBeenCalledTimes(2);
    live.stop();
    expect(sockets[0]!.closed).toBe(true);
  });

  it("reconnects after the socket drops, with a new ticket, and catches up again", async () => {
    vi.useFakeTimers();
    try {
      const { sockets, fetch, createSocket } = fakes();
      const onChange = vi.fn();
      const delays: number[] = [];
      connectLive({ projectId: "p1", onChange, fetch, createSocket, delay: (n) => (delays.push(n), 1000) });
      await vi.runOnlyPendingTimersAsync();
      sockets[0]!.onclose!();
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(sockets).toHaveLength(2);
      sockets[1]!.onmessage!({ data: '{"type":"ready"}' });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(delays).toEqual([0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries when the ticket request fails, and gives up when realtime isn't set up or access is gone", async () => {
    vi.useFakeTimers();
    try {
      const failing = fakes([500, 200]);
      connectLive({ projectId: "p1", onChange: () => {}, fetch: failing.fetch, createSocket: failing.createSocket, delay: () => 1000 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(failing.fetch).toHaveBeenCalledTimes(2);
      expect(failing.sockets).toHaveLength(1);

      for (const status of [503, 404]) {
        const off = fakes([status]);
        connectLive({ projectId: "p1", onChange: () => {}, fetch: off.fetch, createSocket: off.createSocket, delay: () => 1000 });
        await vi.advanceTimersByTimeAsync(10_000);
        expect(off.fetch).toHaveBeenCalledTimes(1);
        expect(off.sockets).toHaveLength(0);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops for good and reports removal on a 'removed' message or a 404 ticket (P-15)", async () => {
    vi.useFakeTimers();
    try {
      const live = fakes();
      const onRemoved = vi.fn();
      connectLive({ projectId: "p1", onChange: () => {}, onRemoved, fetch: live.fetch, createSocket: live.createSocket, delay: () => 1000 });
      await vi.advanceTimersByTimeAsync(0);
      live.sockets[0]!.onmessage!({ data: '{"type":"removed","projectId":"p1"}' });
      live.sockets[0]!.onclose!();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(onRemoved).toHaveBeenCalledTimes(1);
      expect(live.fetch).toHaveBeenCalledTimes(1);

      const gone = fakes([404]);
      const onGone = vi.fn();
      connectLive({ projectId: "p1", onChange: () => {}, onRemoved: onGone, fetch: gone.fetch, createSocket: gone.createSocket, delay: () => 1000 });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(onGone).toHaveBeenCalledTimes(1);
      expect(gone.sockets).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
