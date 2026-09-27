"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FeedEntry, FeedPage } from "@/lib/entries";
import { FeedComposer } from "./feed-composer";
import { FeedEntryView, DayDivider, dayKey } from "./feed-entry";
import { ProjectHeader } from "./project-header";
import styles from "./feed.module.css";

export interface FeedProps {
  project: { id: string; name: string; archived: boolean };
  viewer: { id: string; name: string; role: "owner" | "editor" | "viewer" };
  can: { post: boolean; rename: boolean; archive: boolean };
  initialPage: FeedPage;
}

export function ProjectFeed({ project, viewer, can, initialPage }: FeedProps) {
  const [entries, setEntries] = useState<FeedEntry[]>(initialPage.entries);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  // Keeps the view still when older entries are added above it.
  const anchor = useRef<{ height: number; y: number } | null>(null);

  // Open at the newest entry (D-005) and mark the feed read (D-147).
  useEffect(() => {
    setHydrated(true);
    window.scrollTo(0, document.documentElement.scrollHeight);
    void fetch(`/api/projects/${project.id}/read`, { method: "POST" });
  }, [project.id]);

  useLayoutEffect(() => {
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

  // Scrolling up to the top loads the previous page.
  useEffect(() => {
    const el = top.current;
    if (!el || !cursor) return;
    const observer = new IntersectionObserver(([e]) => e?.isIntersecting && void loadOlder(), { rootMargin: "400px 0px 0px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [cursor, loadOlder]);

  const onSent = (entry: FeedEntry) => {
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
            <FeedEntryView entry={entry} viewerId={viewer.id} />
          </div>
        ))}
      </section>
      </main>
      <footer className={styles.footer}>
        {can.post ? (
          <FeedComposer projectId={project.id} projectName={project.name} onSent={onSent} />
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
