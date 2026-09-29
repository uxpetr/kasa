"use client";

// Kasa Bot's thinking state (D-199): a breathing k, a shimmering step on the card, and a line
// above the composer. An answer that never comes stops "thinking" after BOT_ANSWER_STALE_MS.
import { useEffect, useState } from "react";
import { ANSWERING_TEXT, BOT_CARD_TEXT, isAnswering, isAnswerOpen, READING_MIN_MS, readingText, staleAt, WRITING_TEXT } from "@/lib/bot-cards";
import type { FeedEntry } from "@/lib/entries";
import styles from "./feed.module.css";

/** Re-renders when the earliest of these open answers goes stale, and says which are still on their way. */
function useAnswering(entries: FeedEntry[]): FeedEntry[] {
  const [now, setNow] = useState(() => Date.now());
  const answering = entries.filter((e) => isAnswering(e, now));
  const next = answering.length ? Math.min(...answering.map(staleAt)) : null;
  useEffect(() => {
    if (next === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [next]);
  return answering;
}

export function useIsAnswering(entry: FeedEntry): boolean {
  return useAnswering(isAnswerOpen(entry) ? [entry] : []).length > 0;
}

/** "Reading 24 entries…", held for a moment, then "Writing an answer…" once the worker says so. */
export function BotThinking({ entry }: { entry: FeedEntry }) {
  const [holding, setHolding] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setHolding(false), READING_MIN_MS);
    return () => clearTimeout(timer);
  }, []);
  const n = entry.botEntriesRead;
  const text = entry.botCard === "writing" && !holding ? WRITING_TEXT : n ? readingText(n) : BOT_CARD_TEXT.pending!;
  return (
    <span className={styles.thinking} role="status" data-step={entry.botCard === "writing" && !holding ? "writing" : "reading"}>
      {text}
    </span>
  );
}

/** "Kasa Bot is answering…" above the composer while any answer is on its way; goes to the newest one. */
export function AnsweringLine({ entries, onJump }: { entries: FeedEntry[]; onJump: (id: string) => void }) {
  const answering = useAnswering(entries.filter(isAnswerOpen));
  const latest = answering.at(-1);
  if (!latest) return null;
  return (
    <button type="button" className={styles.answering} onClick={() => onJump(latest.id)}>
      <span className={`${styles.botMark} ${styles.botMarkSmall} ${styles.breathing}`} aria-hidden="true">
        k
      </span>
      {ANSWERING_TEXT}
    </button>
  );
}
