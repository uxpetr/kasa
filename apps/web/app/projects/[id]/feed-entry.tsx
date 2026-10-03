"use client";

import { Fragment, useState, useSyncExternalStore, type ReactNode } from "react";
import { Avatar, BotButton, BotCard, CategoryStamp, DeletedOutline, IndexCard, Note, Polaroid, Print, Reply, tiltFor } from "@kasa/ui";
import { botCardText, isReceipt, receiptParts } from "@/lib/bot-cards";
import { hasCategories, useCategories } from "./categories";
import { BotIdeas } from "./bot-ideas";
import { BotThinking, useIsAnswering } from "./bot-thinking";
import type { FeedEntry } from "@/lib/entries";
import { hostOf, previewLine } from "@/lib/preview";
import { deletedText, EntryActions, nounFor, objectLabel } from "./entry-actions";
import styles from "./feed.module.css";
import { PhotoViewer } from "./photo-viewer";
import { NewProject } from "../../new-project";

const noop = () => () => {};
/** Dates render in the viewer's time zone, so they wait for the client. */
const useOnClient = () => useSyncExternalStore(noop, () => true, () => false);

export const dayKey = (iso: string) => new Date(iso).toDateString();

export function DayDivider({ iso }: { iso: string }) {
  const onClient = useOnClient();
  let label = "";
  if (onClient) {
    const date = new Date(iso);
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    label =
      date.toDateString() === today.toDateString()
        ? "Today"
        : date.toDateString() === yesterday.toDateString()
          ? "Yesterday"
          : date.toLocaleDateString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
              ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
            });
  }
  return (
    <div className={styles.day} role="separator" aria-label={label || undefined}>
      <span>{label}</span>
    </div>
  );
}

function Time({ iso }: { iso: string }) {
  const onClient = useOnClient();
  return <time dateTime={iso}>{onClient ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : null}</time>;
}

const URL_PATTERN = /(https?:\/\/[^\s<>"]+)/g;

/** Text with http(s) URLs as links (D-149). */
export function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_PATTERN);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow ugc">
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** Screenshot box width inside a 330px print. Tall pages are cut off at the top part. */
const PRINT_WIDTH = 314;
const PRINT_MAX_HEIGHT = 240;

interface EntryProps {
  entry: FeedEntry;
  viewerId: string;
  /** Owners and editors, not while archived (lib/access). */
  canAdd: boolean;
  isOwner: boolean;
  archived: boolean;
  onChange: (entry: FeedEntry) => void;
  /** A new entry made from this one, e.g. a Kasa Bot idea added to the pile (P-20). */
  onAdd: (entry: FeedEntry, opts?: { scroll?: boolean }) => void;
  onReply: (entry: FeedEntry) => void;
  /** Scrolls to an entry, loading older pages if needed. */
  onJump: (id: string) => void;
}

/** One entry: avatar, "Name · time", then the object, the same whatever its source (D-016). */
export function FeedEntryView({ entry, viewerId, canAdd, isOwner, archived, onChange, onAdd, onReply, onJump }: EntryProps) {
  const [viewing, setViewing] = useState(false);
  const isBot = entry.kind === "bot";
  // A Telegram group member who hasn't linked Kasa shows by their Telegram name (D-207).
  const name = isBot ? "Kasa Bot" : entry.author?.id === viewerId ? "You" : entry.guest ? `${entry.guest} (guest)` : (entry.author?.name ?? "");
  // Kasa Bot's cards are never tilted (D-197); everything else gets a stable hand-placed tilt.
  const rotate = isBot ? 0 : tiltFor(entry.id);
  const thinking = useIsAnswering(entry);
  const categories = useCategories();

  // An undone sorting receipt leaves the feed (D-201), and so does one with nothing left in it.
  if (isReceipt(entry) && (entry.deleted || !receiptParts(entry))) return null;

  if (entry.deleted) {
    return (
      <article id={`entry-${entry.id}`} tabIndex={-1} className={`${styles.entry} ${styles.deleted}`} aria-label={deletedText(entry, viewerId)}>
        <DeletedOutline text={deletedText(entry, viewerId)} rotate={rotate} />
      </article>
    );
  }

  const label = objectLabel(entry, viewerId);
  const photoAlt = entry.body ? entry.body : `Photo from ${entry.author?.name ?? entry.guest ?? "someone"}`;

  let object: ReactNode;
  if (entry.kind === "note" || entry.kind === "decision") {
    const text = entry.body ?? "";
    object = (
      <Note text={text} rotate={rotate}>
        <Linkified text={text} />
      </Note>
    );
  } else if (isReceipt(entry)) {
    object = <ReceiptCard entry={entry} canEdit={categories.canEdit} onEdit={categories.openEditor} onChange={onChange} />;
  } else if (isBot) {
    object = (
      <BotCard
        header={false}
        actions={entry.botCard === "welcome" ? <NewProject trigger={(open) => <BotButton onClick={open}>Start a pile</BotButton>} /> : undefined}
      >
        {thinking ? <BotThinking entry={entry} /> : botCardText(entry)}
        {!thinking && entry.ideas.length ? <BotIdeas entry={entry} canAdd={canAdd} onChange={onChange} onAdd={onAdd} /> : null}
      </BotCard>
    );
  } else if (entry.kind === "photo" && entry.photos.length > 0) {
    const [first] = entry.photos;
    const count = entry.photos.length;
    object = (
      <Polaroid
        src={`/api/media/${first!.uploadId}/thumb`}
        alt={photoAlt}
        caption={entry.body ?? undefined}
        moreCount={count > 1 ? count - 1 : undefined}
        rotate={rotate}
        imageHeight={first!.width && first!.height ? Math.round((174 * first!.height) / first!.width) : 130}
        onOpen={() => setViewing(true)}
        openLabel={count > 1 ? `Open ${count} photos` : "Open photo"}
      />
    );
  } else if (entry.kind === "link" && entry.link) {
    const host = hostOf(entry.link.url) ?? entry.link.url;
    object = (
      <IndexCard
        href={entry.link.url}
        label={`Link · ${entry.link.siteName ?? host}`}
        title={entry.link.title ?? host}
        imageSrc={entry.link.hasImage ? `/api/entries/${entry.id}/preview-image` : undefined}
        rotate={rotate}
      >
        {entry.link.title ? null : <span className={styles.linkUrl}>{entry.link.url}</span>}
      </IndexCard>
    );
  } else if (entry.kind === "capture" && entry.capture?.screenshot) {
    const { capture } = entry;
    const shot = capture.screenshot!;
    const fullHeight = shot.width && shot.height ? (PRINT_WIDTH * shot.height) / shot.width : PRINT_WIDTH * 0.625;
    const boxHeight = Math.round(Math.min(fullHeight, PRINT_MAX_HEIGHT));
    // Pins are fractions of the whole screenshot; the print shows its top part.
    const pins = capture.pins.map((p) => ({ ...p, y: (p.y * fullHeight) / boxHeight })).filter((p) => p.y <= 1);
    const host = hostOf(capture.pageUrl) ?? capture.pageUrl;
    object = (
      <Print
        src={`/api/entries/${entry.id}/media/${shot.mediaId}`}
        alt={`Capture of ${capture.pageTitle ?? host}`}
        rotate={rotate}
        pins={pins}
        imageHeight={boxHeight}
      >
        {capture.note ? (
          <span className={styles.printNote}>
            <span className={styles.pinNumber}>1</span> {capture.note}
          </span>
        ) : null}
        <span className={styles.printSource}>
          from {host} ·{" "}
          <a href={capture.pageUrl} target="_blank" rel="noopener noreferrer nofollow ugc">
            Open original
          </a>
        </span>
      </Print>
    );
  } else {
    const line = previewLine(
      { kind: entry.kind, body: entry.body, authorId: null, authorName: null, linkTitle: entry.link?.title ?? null, pageUrl: entry.capture?.pageUrl ?? null },
      viewerId,
    );
    object = <p className={styles.fallback}>{line}</p>;
  }

  const quoted = entry.replyTo;
  if (quoted) {
    object = (
      <Reply
        quote={<QuotePrint entry={quoted} viewerId={viewerId} />}
        quoteLabel={`Go to ${quoted.deleted ? `the deleted ${nounFor(quoted)}` : objectLabel(quoted, viewerId)}`}
        paper={quoted.deleted ? "plain" : quoted.kind === "note" || quoted.kind === "decision" ? "note" : quoted.kind === "bot" ? "bot" : "plain"}
        onSelectQuote={() => onJump(quoted.id)}
      >
        {object}
      </Reply>
    );
  }

  return (
    <article id={`entry-${entry.id}`} tabIndex={-1} className={styles.entry} aria-label={`${name}, ${entry.kind}`}>
      {isBot ? (
        <span className={thinking ? `${styles.botMark} ${styles.breathing}` : styles.botMark} aria-hidden="true">
          k
        </span>
      ) : entry.author ? (
        <Avatar person={entry.author} size={36} />
      ) : entry.guest ? (
        <span className={styles.avatarGuest} aria-hidden="true">
          {entry.guest.trim().charAt(0).toUpperCase()}
        </span>
      ) : (
        <span className={styles.avatarBlank} aria-hidden="true" />
      )}
      <div className={styles.entryBody}>
        <div className={styles.meta}>
          <span className={styles.author}>{name}</span> · <Time iso={entry.createdAt} />
          {entry.source === "telegram" ? " · via Telegram" : null}
          {entry.fromBot ? " · from Kasa Bot" : null}
          {entry.categories.map((c) => (
            <CategoryStamp key={c.id}>{c.name}</CategoryStamp>
          ))}
        </div>
        <EntryActions
          entry={entry}
          label={label}
          canReact={canAdd}
          canDelete={!archived && (isOwner || (entry.author !== null && entry.author.id === viewerId))}
          onChange={onChange}
          onReply={canAdd ? onReply : undefined}
          onCategories={categories.canEdit && hasCategories(entry) ? () => categories.editEntry(entry) : undefined}
        >
          {object}
        </EntryActions>
      </div>
      {viewing ? <PhotoViewer entry={entry} alt={photoAlt} onClose={() => setViewing(false)} /> : null}
    </article>
  );
}

/** The small print of an original on a reply: its image, or its first words. */
function QuotePrint({ entry, viewerId }: { entry: FeedEntry; viewerId: string }) {
  if (entry.deleted) return <span className="kasa-quote-text">{deletedText(entry, viewerId)}</span>;
  const image = entry.photos[0]
    ? `/api/media/${entry.photos[0].uploadId}/thumb`
    : entry.capture?.screenshot
      ? `/api/entries/${entry.id}/media/${entry.capture.screenshot.mediaId}`
      : entry.link?.hasImage
        ? `/api/entries/${entry.id}/preview-image`
        : null;
  const text =
    entry.kind === "link" && entry.link
      ? (entry.link.title ?? hostOf(entry.link.url) ?? entry.link.url)
      : entry.body ??
        previewLine({ kind: entry.kind, body: null, authorId: null, authorName: null, linkTitle: null, pageUrl: entry.capture?.pageUrl ?? null }, viewerId);
  return (
    <>
      {image ? <img src={image} alt="" /> : null}
      {!image || entry.body ? <span className="kasa-quote-text">{text}</span> : null}
    </>
  );
}

/** A sorting receipt (D-201): "Sorted 3 new things into **Sights**. Undo", or the first sort's names and Edit. */
function ReceiptCard({ entry, canEdit, onEdit, onChange }: { entry: FeedEntry; canEdit: boolean; onEdit: () => void; onChange: (entry: FeedEntry) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parts = receiptParts(entry)!;
  const first = entry.botCard === "sorted-first";
  // The names in bold, joined the way listNames joins them.
  const bold = parts.names.map((n, i) => (
    <Fragment key={n}>
      {i === 0 ? "" : i === parts.names.length - 1 ? " and " : ", "}
      <strong>{n}</strong>
    </Fragment>
  ));
  return (
    <BotCard header={false}>
      <span className={styles.receipt}>
        <span>
          {parts.before}
          {bold}
          {parts.after}
        </span>
        {canEdit ? (
          first ? (
            <button type="button" className={styles.receiptAction} onClick={onEdit}>
              Edit
            </button>
          ) : (
            <button
              type="button"
              className={styles.receiptAction}
              disabled={pending}
              onClick={async () => {
                setPending(true);
                const res = await fetch(`/api/entries/${entry.id}/undo`, { method: "POST" }).catch(() => null);
                setPending(false);
                if (res?.ok) onChange({ ...entry, deleted: true });
                else setError("Couldn't undo that. Try again.");
              }}
            >
              Undo
            </button>
          )
        ) : null}
      </span>
      {error ? (
        <span role="alert" className={styles.actionError}>
          {error}
        </span>
      ) : null}
    </BotCard>
  );
}
