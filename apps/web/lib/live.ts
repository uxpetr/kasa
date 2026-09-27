// Browser side of live updates (P-06). Pure of React and the DOM globals it's given, so it can be tested.
import type { FeedEntry } from "./entries";

const order = (a: FeedEntry, b: FeedEntry) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/**
 * Applies changed entries to the loaded feed: replaces the ones already shown and adds
 * new ones, except entries older than what's loaded (they appear when paging back).
 */
export function mergeChanges(current: FeedEntry[], changed: FeedEntry[], { complete }: { complete: boolean }): FeedEntry[] {
  if (changed.length === 0) return current;
  const byId = new Map(current.map((e) => [e.id, e]));
  const oldest = current[0];
  for (const entry of changed) {
    if (byId.has(entry.id) || complete || !oldest || order(entry, oldest) > 0) byId.set(entry.id, entry);
  }
  return [...byId.values()].sort(order);
}

interface SocketLike {
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  close(): void;
}

export interface LiveOptions {
  projectId: string;
  /** Called when the project changed, and after every (re)connect to catch up. */
  onChange: () => void;
  fetch?: typeof fetch;
  createSocket?: (url: string) => SocketLike;
  /** Retry delays grow from 1s to 30s. */
  delay?: (attempt: number) => number;
}

export const backoff = (attempt: number) => Math.min(30_000, 1000 * 2 ** attempt) * (0.75 + Math.random() * 0.5);

/** Keeps a WebSocket open to the realtime service, reconnecting with backoff. Returns a stop function. */
export function connectLive({
  projectId,
  onChange,
  fetch: doFetch = (...args) => fetch(...args),
  createSocket = (url) => new WebSocket(url),
  delay = backoff,
}: LiveOptions) {
  let stopped = false;
  let attempt = 0;
  let socket: SocketLike | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const retry = () => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void open();
    }, delay(attempt++));
  };

  async function open() {
    if (stopped || socket) return;
    const res = await doFetch(`/api/projects/${projectId}/realtime`, { method: "POST" }).catch(() => null);
    if (stopped) return;
    // Not set up (503) or no longer a member (404): nothing to retry.
    if (res && (res.status === 503 || res.status === 404 || res.status === 401)) return;
    if (!res?.ok) return retry();
    const { url, ticket } = (await res.json()) as { url: string; ticket: string };
    if (stopped) return;
    const ws = createSocket(`${url}?ticket=${encodeURIComponent(ticket)}`);
    socket = ws;
    ws.onmessage = (event) => {
      let type: unknown;
      try {
        type = (JSON.parse(String(event.data)) as { type?: unknown }).type;
      } catch {
        return;
      }
      if (type === "ready") attempt = 0;
      if (type === "ready" || type === "changed") onChange();
    };
    ws.onclose = () => {
      if (socket === ws) socket = null;
      retry();
    };
  }

  void open();
  return {
    /** Try now instead of waiting, e.g. when the browser comes back online. */
    wake() {
      if (stopped || socket) return;
      if (timer) clearTimeout(timer);
      timer = null;
      void open();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      const ws = socket;
      socket = null;
      ws?.close();
    },
  };
}
