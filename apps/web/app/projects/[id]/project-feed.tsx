"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isReceipt, receiptParts } from "@/lib/bot-cards";
import type { CategoryChipData } from "@/lib/categories";
import type { FeedChanges, FeedEntry, FeedPage } from "@/lib/entries";
import { connectLive, mergeChanges } from "@/lib/live";
import { AnsweringLine } from "./bot-thinking";
import { CategoriesContext, CategoriesDialog, CategoryBar, EntryCategoriesDialog } from "./categories";
import { FeedComposer } from "./feed-composer";
import { objectLabel } from "./entry-actions";
import { FeedEntryView, DayDivider, dayKey } from "./feed-entry";
import { ProjectHeader } from "./project-header";
import styles from "./feed.module.css";

export interface FeedProps {
  project: { id: string; name: string; archived: boolean };
  viewer: { id: string; name: string; role: "owner" | "editor" | "viewer"; emailsMuted: boolean };
  can: { post: boolean; rename: boolean; archive: boolean; manageMembers: boolean; leave: boolean; invite: boolean; editCategories: boolean; telegram: boolean };
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
  // Categories (P-19): the chips, the chip being filtered on, and the dialogs.
  const [chips, setChips] = useState<CategoryChipData[]>(initialPage.categories);
  const [postCount, setPostCount] = useState(initialPage.postCount);
  const [filter, setFilter] = useState<string | null>(null);
  const filterRef = useRef<string | null>(null);
  // Posted while filtering: stays in view, with its replies, until the filter changes.
  const shownHere = useRef(new Set<string>());
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<FeedEntry | null>(null);
  const pageUrl = useCallback(
    (params: Record<string, string> = {}) => {
      const query = new URLSearchParams(params);
      if (filterRef.current) query.set("category", filterRef.current);
      const qs = query.toString();
      return `/api/projects/${project.id}/entries${qs ? `?${qs}` : ""}`;
    },
    [project.id],
  );
  /** Whether an entry belongs in the filtered feed: in the category, a reply to one, or posted here. */
  const inFilter = useCallback((e: FeedEntry) => {
    const id = filterRef.current;
    if (!id) return true;
    const has = (x: FeedEntry | null) => !!x && (x.categories.some((c) => c.id === id) || shownHere.current.has(x.id));
    return has(e) || has(e.replyTo);
  }, []);

  // Open at the newest entry (D-005) and mark the feed read (D-147).
  useEffect(() => {
    setHydrated(true);
    window.scrollTo(0, document.documentElement.scrollHeight);
    void fetch(`/api/projects/${project.id}/read?opened=1`, { method: "POST" });
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
    const res = await fetch(pageUrl({ before: cursor })).catch(() => null);
    if (res?.ok) {
      const page = (await res.json()) as FeedPage;
      anchor.current = { height: document.documentElement.scrollHeight, y: window.scrollY };
      setEntries((current) => [...page.entries, ...current]);
      setCursor(page.nextCursor);
    }
    setLoadingOlder(false);
  }, [cursor, loadingOlder, pageUrl]);

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
        setChips(changes.categories);
        setPostCount(changes.postCount);
        if (changes.truncated) {
          // Too much changed while away: start again from the newest page.
          const page = await fetch(pageUrl()).then((r) => (r.ok ? (r.json() as Promise<FeedPage>) : null)).catch(() => null);
          if (stopped || !page) break;
          follow.current = atBottom;
          setEntries(page.entries);
          setCursor(page.nextCursor);
          since.current = page.syncedAt;
        } else {
          since.current = changes.syncedAt;
          if (changes.entries.length === 0) continue;
          follow.current = atBottom;
          // While filtering, an entry that left the category leaves the view too.
          setEntries((current) => mergeChanges(current, changes.entries, { complete: cursorRef.current === null }).filter(inFilter));
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
  }, [project.id, router, pageUrl, inFilter]);

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
        const res = await fetch(pageUrl({ before })).catch(() => null);
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
    [pageUrl],
  );

  /** Picks a chip: the feed reloads with only that category's posts and their replies (D-201). */
  const selectFilter = useCallback(
    async (id: string | null) => {
      filterRef.current = id;
      shownHere.current.clear();
      setFilter(id);
      const page = await fetch(pageUrl()).then((r) => (r.ok ? (r.json() as Promise<FeedPage>) : null)).catch(() => null);
      if (!page || filterRef.current !== id) return;
      follow.current = true;
      setEntries(page.entries);
      setCursor(page.nextCursor);
      setChips(page.categories);
      setPostCount(page.postCount);
    },
    [pageUrl],
  );

  // A filtered category that was removed or merged away: back to All.
  useEffect(() => {
    if (filter && !chips.some((c) => c.id === filter)) void selectFilter(null);
  }, [chips, filter, selectFilter]);

  const refreshChips = useCallback(async () => {
    const res = await fetch(`/api/projects/${project.id}/categories`).catch(() => null);
    if (res?.ok) setChips((await res.json()) as CategoryChipData[]);
  }, [project.id]);

  const categoriesApi = useMemo(
    () => ({ chips, canEdit: can.editCategories, openEditor: () => setEditorOpen(true), editEntry: setEditing }),
    [chips, can.editCategories],
  );

  // An undone sorting receipt, or one with nothing left in it, isn't shown (D-201).
  const visible = entries.filter((e) => !(isReceipt(e) && (e.deleted || !receiptParts(e))));

  const onSent = (entry: FeedEntry) => {
    setReplyingTo(null);
    onAdd(entry, { scroll: true });
  };
  // Live sync may have brought it in first.
  const onAdd = (entry: FeedEntry, { scroll = false } = {}) => {
    if (filterRef.current) shownHere.current.add(entry.id);
    setEntries((current) => (current.some((e) => e.id === entry.id) ? current : [...current, entry]));
    if (scroll) requestAnimationFrame(() => window.scrollTo(0, document.documentElement.scrollHeight));
  };

  return (
    // data-hydrated: the menu opens natively before its actions are wired up; tests wait for this.
    <CategoriesContext.Provider value={categoriesApi}>
    <div className={styles.page} data-hydrated={hydrated || undefined}>
      <ProjectHeader project={project} viewer={viewer} can={can} />
      <CategoryBar chips={chips} postCount={postCount} filter={filter} onFilter={(id) => void selectFilter(id)} />
      <main className={styles.main}>
      <section aria-label="Feed" className={styles.feed} aria-busy={loadingOlder}>
        <div ref={top} className={styles.top} />
        {visible.length === 0 && !filter ? <p className={styles.empty}>Nothing here yet. Paste a link, drop a photo, or write a note.</p> : null}
        {visible.map((entry, i) => (
          <div key={entry.id} className={styles.item}>
            {i === 0 || dayKey(visible[i - 1]!.createdAt) !== dayKey(entry.createdAt) ? <DayDivider iso={entry.createdAt} /> : null}
            <div className={styles.jumpTarget} data-highlight={highlight === entry.id || undefined}>
              <FeedEntryView
                entry={entry}
                viewerId={viewer.id}
                canAdd={can.post}
                isOwner={viewer.role === "owner"}
                archived={project.archived}
                onChange={onChange}
                onAdd={onAdd}
                onReply={setReplyingTo}
                onJump={jumpTo}
              />
            </div>
          </div>
        ))}
      </section>
      </main>
      <footer className={styles.footer}>
        <AnsweringLine entries={entries} onJump={jumpTo} />
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
      {editorOpen ? (
        <CategoriesDialog projectId={project.id} chips={chips} onClose={() => setEditorOpen(false)} onChanged={() => void refreshChips()} />
      ) : null}
      {editing ? (
        <EntryCategoriesDialog
          projectId={project.id}
          entry={editing}
          chips={chips}
          onClose={() => setEditing(null)}
          onChange={onChange}
          onChipsChanged={() => void refreshChips()}
        />
      ) : null}
    </div>
    </CategoriesContext.Provider>
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
