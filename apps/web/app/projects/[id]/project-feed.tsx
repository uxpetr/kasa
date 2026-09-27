"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FeedChanges, FeedEntry, FeedPage } from "@/lib/entries";
import { connectLive, mergeChanges } from "@/lib/live";
import { FeedComposer } from "./feed-composer";
import { objectLabel } from "./entry-actions";
import { FeedEntryView, DayDivider, dayKey } from "./feed-entry";
import { ProjectHeader } from "./project-header";
import styles from "./feed.module.css";

export interface FeedProps {
  project: { id: string; name: string; archived: boolean };
  viewer: { id: string; name: string; role: "owner" | "editor" | "viewer"; emailsMuted: boolean };
  can: { post: boolean; rename: boolean; archive: boolean; manageMembers: boolean; leave: boolean; invite: boolean };
  initialPage: FeedPage;
}

export function ProjectFeed({ project, viewer, can, initialPage }: FeedProps) {
  const router = useRouter();
  const [entries, setEntries] = useState<FeedEntry[]>(initialPage.entries);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [replyingTo, setReplyingTo] = useState<FeedEntry | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);
  // Keeps the view still when older entries are added above it.
  const anchor = useRef<{ height: number; y: number } | null>(null);
  // Follows new entries when the reader is already at the bottom.
  const follow = useRef(false);
  const since = useRef(initialPage.syncedAt);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  // Open at the newest entry (D-005) and mark the feed read (D-147).
  useEffect(() => {
    setHydrated(true);
    window.scrollTo(0, document.documentElement.scrollHeight);
    void fetch(`/api/projects/${project.id}/read`, { method: "POST" });
  }, [project.id]);

  useLayoutEffect(() => {
    if (follow.current) {
      follow.current = false;
      window.scrollTo(0, document.documentElement.scrollHeight);
    }
    if (!anchor.current) return;
    window.scrollTo(0, anchor.current.y + document.documentElement.scrollHeight - anchor.current.height);
    anchor.current = null;
  }, [entries]);

  const loadOlder = useCallback(async () => {
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true);
    const res = await fetch(`/api/projects/${project.id}/entries?before=${encodeURIComponent(cursor)}`).catch(() => null);
    if (res?.ok) {
      const page = (await res.json()) as FeedPage;
      anchor.current = { height: document.documentElement.scrollHeight, y: window.scrollY };
      setEntries((current) => [...page.entries, ...current]);
      setCursor(page.nextCursor);
    }
    setLoadingOlder(false);
  }, [cursor, loadingOlder, project.id]);

  // Live updates (P-06): the realtime service says "changed", then we fetch what changed.
  useEffect(() => {
    let pulling = false;
    let again = false;
    let stopped = false;
    const nearBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 120;

    async function pull() {
      if (pulling) {
        again = true;
        return;
      }
      pulling = true;
      do {
        again = false;
        const res = await fetch(`/api/projects/${project.id}/entries?since=${encodeURIComponent(since.current)}`).catch(() => null);
        if (stopped || !res?.ok) break;
        const changes = (await res.json()) as FeedChanges;
        const atBottom = nearBottom();
        if (changes.truncated) {
          // Too much changed while away: start again from the newest page.
          const page = await fetch(`/api/projects/${project.id}/entries`).then((r) => (r.ok ? (r.json() as Promise<FeedPage>) : null)).catch(() => null);
          if (stopped || !page) break;
          follow.current = atBottom;
          setEntries(page.entries);
          setCursor(page.nextCursor);
          since.current = page.syncedAt;
        } else {
          since.current = changes.syncedAt;
          if (changes.entries.length === 0) continue;
          follow.current = atBottom;
          setEntries((current) => mergeChanges(current, changes.entries, { complete: cursorRef.current === null }));
        }
        // New things seen while the feed is open count as read (D-147).
        if (document.visibilityState === "visible") void fetch(`/api/projects/${project.id}/read`, { method: "POST" });
      } while (again && !stopped);
      pulling = false;
    }

    // Removed from the pile, or left in another tab: back to Your piles, no message (D-171).
    const live = connectLive({ projectId: project.id, onChange: () => void pull(), onRemoved: () => router.replace("/") });
    const wake = () => live.wake();
    window.addEventListener("online", wake);
    return () => {
      stopped = true;
      live.stop();
      window.removeEventListener("online", wake);
    };
  }, [project.id, router]);

  // Scrolling up to the top loads the previous page.
  useEffect(() => {
    const el = top.current;
    if (!el || !cursor) return;
    const observer = new IntersectionObserver(([e]) => e?.isIntersecting && void loadOlder(), { rootMargin: "400px 0px 0px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [cursor, loadOlder]);

  const onChange = useCallback((changed: FeedEntry) => {
    setEntries((current) => current.map((e) => (e.id === changed.id ? changed : e)));
  }, []);

  // Tapping a reply's clipped print: go to the original, loading older pages until it's there.
  const jumpTo = useCallback(
    async (id: string) => {
      const show = () => {
        const el = document.getElementById(`entry-${id}`);
        if (!el) return false;
        el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        el.focus({ preventScroll: true });
        setHighlight(id);
        window.setTimeout(() => setHighlight((current) => (current === id ? null : current)), 2000);
        return true;
      };
      if (show()) return;
      let before = cursorRef.current;
      const older: FeedEntry[] = [];
      for (let i = 0; before && i < 20 && !older.some((e) => e.id === id); i++) {
        const res = await fetch(`/api/projects/${project.id}/entries?before=${encodeURIComponent(before)}`).catch(() => null);
        if (!res?.ok) return;
        const page = (await res.json()) as FeedPage;
        older.unshift(...page.entries);
        before = page.nextCursor;
      }
      if (!older.length) return;
      setEntries((current) => [...older.filter((e) => !current.some((c) => c.id === e.id)), ...current]);
      setCursor(before);
      requestAnimationFrame(() => requestAnimationFrame(show));
    },
    [project.id],
  );

  const onSent = (entry: FeedEntry) => {
    setReplyingTo(null);
    setEntries((current) => [...current, entry]);
    requestAnimationFrame(() => window.scrollTo(0, document.documentElement.scrollHeight));
  };

  return (
    // data-hydrated: the menu opens natively before its actions are wired up; tests wait for this.
    <div className={styles.page} data-hydrated={hydrated || undefined}>
      <ProjectHeader project={project} viewer={viewer} can={can} />
      <main className={styles.main}>
      <section aria-label="Feed" className={styles.feed} aria-busy={loadingOlder}>
        <div ref={top} className={styles.top} />
        {entries.length === 0 ? <p className={styles.empty}>Nothing here yet. Paste a link, drop a photo, or write a note.</p> : null}
        {entries.map((entry, i) => (
          <div key={entry.id} className={styles.item}>
            {i === 0 || dayKey(entries[i - 1]!.createdAt) !== dayKey(entry.createdAt) ? <DayDivider iso={entry.createdAt} /> : null}
            <div className={styles.jumpTarget} data-highlight={highlight === entry.id || undefined}>
              <FeedEntryView
                entry={entry}
                viewerId={viewer.id}
                canAdd={can.post}
                isOwner={viewer.role === "owner"}
                onChange={onChange}
                onReply={setReplyingTo}
                onJump={jumpTo}
              />
            </div>
          </div>
        ))}
      </section>
      </main>
      <footer className={styles.footer}>
        {can.post ? (
          <FeedComposer
            projectId={project.id}
            projectName={project.name}
            viewerId={viewer.id}
            onSent={onSent}
            replyTo={replyingTo ? { id: replyingTo.id, label: objectLabel(replyingTo, viewer.id) } : null}
            onCancelReply={() => setReplyingTo(null)}
          />
        ) : project.archived ? (
          <ArchivedNotice projectId={project.id} canUnarchive={can.archive} />
        ) : (
          <p className={styles.notice}>You can view this pile but not add to it.</p>
        )}
      </footer>
    </div>
  );
}

function ArchivedNotice({ projectId, canUnarchive }: { projectId: string; canUnarchive: boolean }) {
  const [pending, setPending] = useState(false);
  return (
    <p className={styles.notice}>
      This pile is archived.
      {canUnarchive ? (
        <button
          type="button"
          className={styles.noticeAction}
          disabled={pending}
          onClick={async () => {
            setPending(true);
            const res = await fetch(`/api/projects/${projectId}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ archived: false }),
            }).catch(() => null);
            if (res?.ok) window.location.reload();
            else setPending(false);
          }}
        >
          Unarchive
        </button>
      ) : null}
    </p>
  );
}
