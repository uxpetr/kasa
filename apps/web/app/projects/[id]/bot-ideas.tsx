"use client";

import { useState } from "react";
import { BotButton } from "@kasa/ui";
import type { FeedEntry, FeedIdea } from "@/lib/entries";
import { hostOf } from "@/lib/preview";
import styles from "./feed.module.css";

/**
 * A Kasa Bot answer's recommendations (P-20, D-204): up to three ideas, each with "Add to pile",
 * and "More ideas" for different ones. Members who can't add see the ideas without the buttons.
 */
export function BotIdeas({
  entry,
  canAdd,
  onChange,
  onAdd,
}: {
  entry: FeedEntry;
  canAdd: boolean;
  onChange: (entry: FeedEntry) => void;
  /** A new entry from here: the added link, or the card with more ideas. */
  onAdd: (entry: FeedEntry, opts?: { scroll?: boolean }) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add(idea: FeedIdea) {
    setPending(idea.id);
    setError(null);
    const res = await fetch(`/api/ideas/${idea.id}/add`, { method: "POST" }).catch(() => null);
    setPending(null);
    const link = res?.ok ? ((await res.json()) as FeedEntry) : null;
    if (!link) return setError("Couldn't add that. Try again.");
    onChange({
      ...entry,
      ideas: entry.ideas.map((i) => (i.id === idea.id ? { ...i, added: { entryId: link.id, category: link.categories[0]?.name ?? null } } : i)),
    });
    onAdd(link);
  }

  async function more() {
    setPending("more");
    setError(null);
    const res = await fetch(`/api/entries/${entry.id}/more-ideas`, { method: "POST" }).catch(() => null);
    setPending(null);
    if (!res?.ok) return setError("Couldn't ask for more. Try again.");
    onAdd((await res.json()) as FeedEntry, { scroll: true });
  }

  return (
    <div className={styles.ideas}>
      <ul className={styles.ideaList}>
        {entry.ideas.map((idea) => (
          <li key={idea.id} className={styles.idea}>
            {idea.hasImage ? (
              <span className={styles.ideaPhoto}>
                <img src={`/api/entries/${entry.id}/ideas/${idea.id}/image`} alt="" loading="lazy" />
              </span>
            ) : null}
            <span className={styles.ideaText}>
              <a className={styles.ideaTitle} href={idea.url} target="_blank" rel="noopener noreferrer nofollow ugc">
                {idea.title}
              </a>
              {idea.note ? <span>{idea.note}</span> : null}
              <span className={styles.ideaSite}>{idea.siteName ?? hostOf(idea.url) ?? idea.url}</span>
              {idea.added ? (
                <span className={styles.ideaAdded}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12l5 5 9-10" />
                  </svg>
                  Added to {idea.added.category ?? "pile"}
                </span>
              ) : canAdd ? (
                <span>
                  <BotButton disabled={pending !== null} onClick={() => void add(idea)} aria-label={`Add ${idea.title} to pile`}>
                    Add to pile
                  </BotButton>
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {canAdd ? (
        <span className="kasa-bot-actions">
          <BotButton variant="secondary" disabled={pending !== null} onClick={() => void more()}>
            More ideas
          </BotButton>
        </span>
      ) : null}
      {error ? (
        <span role="alert" className={styles.actionError}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
