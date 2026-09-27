"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { FeedEntry } from "@/lib/entries";
import { REACTIONS, type Reaction } from "@/lib/reactions";
import controls from "../../controls.module.css";
import styles from "./feed.module.css";

const REACTION_NAMES: Record<Reaction, string> = {
  "❤️": "Heart",
  "👍": "Thumbs up",
  "😂": "Laughing",
  "😮": "Surprised",
  "🎉": "Party",
  "👀": "Eyes",
};

const NOUN: Record<FeedEntry["kind"], string> = {
  note: "note",
  photo: "photo",
  link: "link",
  capture: "capture",
  drawing: "drawing",
  file: "file",
  decision: "decision",
  bot: "Kasa Bot message",
};

export const nounFor = (entry: FeedEntry) => NOUN[entry.kind];

/** "Mika deleted a note", "You deleted Mika's photo" (D-155). */
export function deletedText(entry: FeedEntry, viewerId: string): string {
  const noun = nounFor(entry);
  const { author, deletedBy } = entry;
  const who = (p: { id: string; name: string }) => (p.id === viewerId ? "You" : p.name);
  if (!deletedBy) return `A ${noun} was deleted`;
  if (!author || author.id === deletedBy.id) return `${who(deletedBy)} deleted a ${noun}`;
  const whose = author.id === viewerId ? "your" : `${author.name}'s`;
  return `${who(deletedBy)} deleted ${whose} ${noun}`;
}

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  if (res?.ok) return { ok: true as const, data: (await res.json()) as unknown };
  const error = res ? (((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Something went wrong") : "Something went wrong";
  return { ok: false as const, error };
}

interface ActionsProps {
  entry: FeedEntry;
  /** Accessible name of the object, such as "Mika's note". */
  label: string;
  canReact: boolean;
  canDelete: boolean;
  onChange: (entry: FeedEntry) => void;
  children: ReactNode;
}

/**
 * The one actions menu (D-016): hover or focus shows the button, long-press opens it on touch.
 * React and Delete for now (D-153); reactions show as counts under the object (D-154).
 */
export function EntryActions({ entry, label, canReact, canDelete, onChange, children }: ActionsProps) {
  const menu = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const press = useRef<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuId = `actions-${entry.id}`;
  const hasMenu = canReact || canDelete;

  async function toggle(emoji: Reaction, on: boolean) {
    menu.current?.hidePopover();
    const result = await send(`/api/entries/${entry.id}/reactions`, on ? "PUT" : "DELETE", { emoji });
    if (result.ok) onChange({ ...entry, reactions: (result.data as { reactions: FeedEntry["reactions"] }).reactions });
    else setError(result.error);
  }

  // Long-press on touch opens the menu (a bottom sheet on touch screens).
  const cancelPress = () => {
    if (press.current !== null) window.clearTimeout(press.current);
    press.current = null;
  };
  const touchHandlers = hasMenu
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          if (e.pointerType !== "touch") return;
          cancelPress();
          press.current = window.setTimeout(() => {
            press.current = null;
            const el = menu.current as (HTMLDivElement & { showPopover(options?: { source?: HTMLElement }): void }) | null;
            try {
              el?.showPopover({ source: button.current ?? undefined });
            } catch {
              el?.showPopover();
            }
          }, 500);
        },
        onPointerUp: cancelPress,
        onPointerCancel: cancelPress,
        onPointerMove: cancelPress,
        onContextMenu: (e: React.MouseEvent) => {
          if (e.nativeEvent instanceof PointerEvent && e.nativeEvent.pointerType === "touch") e.preventDefault();
        },
      }
    : {};

  const mine = new Set(entry.reactions.filter((r) => r.mine).map((r) => r.emoji));

  return (
    <div className={styles.objectWrap} {...touchHandlers}>
      {children}
      {entry.reactions.length > 0 ? (
        <ul className={styles.reactions} aria-label="Reactions">
          {entry.reactions.map((r) => (
            <li key={r.emoji}>
              {canReact ? (
                <button
                  type="button"
                  className={styles.reaction}
                  aria-pressed={r.mine}
                  aria-label={`${REACTION_NAMES[r.emoji]}, ${r.count}`}
                  onClick={() => toggle(r.emoji, !r.mine)}
                >
                  <span aria-hidden="true">{r.emoji}</span> {r.count}
                </button>
              ) : (
                <span className={styles.reaction} aria-label={`${REACTION_NAMES[r.emoji]}, ${r.count}`}>
                  <span aria-hidden="true">{r.emoji}</span> {r.count}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className={styles.actionError}>
          {error}
        </p>
      ) : null}

      {hasMenu ? (
        <>
          <button ref={button} type="button" className={styles.actionsButton} popoverTarget={menuId} aria-label={`Actions for ${label}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </button>
          <div id={menuId} ref={menu} popover="auto" role="menu" aria-label={`Actions for ${label}`} className={`${controls.menu} ${styles.entryMenu}`}>
            {canReact ? (
              <div role="group" aria-label="React" className={styles.picker}>
                {REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={mine.has(emoji)}
                    aria-label={REACTION_NAMES[emoji]}
                    className={styles.pickerItem}
                    onClick={() => toggle(emoji, !mine.has(emoji))}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                role="menuitem"
                className={controls.menuItem}
                onClick={() => {
                  menu.current?.hidePopover();
                  setError(null);
                  setConfirming(true);
                }}
              >
                Delete
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {confirming ? (
        <ConfirmDelete
          entry={entry}
          onCancel={() => {
            setConfirming(false);
            button.current?.focus();
          }}
          onDeleted={(deleted) => {
            setConfirming(false);
            onChange(deleted);
          }}
        />
      ) : null}
    </div>
  );
}

function ConfirmDelete({ entry, onCancel, onDeleted }: { entry: FeedEntry; onCancel: () => void; onDeleted: (entry: FeedEntry) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = `delete-${entry.id}`;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog ref={dialog} className={controls.dialog} aria-labelledby={titleId} onClose={() => !pending && onCancel()}>
      <h2 id={titleId}>Delete this {nounFor(entry)}?</h2>
      {error ? (
        <p role="alert" className={controls.error}>
          {error}
        </p>
      ) : null}
      <div className={controls.actions}>
        <button type="button" className={controls.secondary} onClick={() => dialog.current?.close()}>
          Cancel
        </button>
        <button
          type="button"
          className={controls.primary}
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError(null);
            const result = await send(`/api/entries/${entry.id}`, "DELETE");
            setPending(false);
            if (result.ok) onDeleted(result.data as FeedEntry);
            else setError(result.error);
          }}
        >
          Delete
        </button>
      </div>
    </dialog>
  );
}
