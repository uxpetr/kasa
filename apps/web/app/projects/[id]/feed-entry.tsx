"use client";

import { Fragment, useSyncExternalStore, type ReactNode } from "react";
import { Avatar, BotCard, Note, Polaroid, tiltFor } from "@kasa/ui";
import type { FeedEntry } from "@/lib/entries";
import { hostOf, previewLine } from "@/lib/preview";
import styles from "./feed.module.css";

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

/**
 * One entry: avatar, "Name · time", then the object. P-04 replaces the simple
 * link and fallback cards with the full content types.
 */
export function FeedEntryView({ entry, viewerId }: { entry: FeedEntry; viewerId: string }) {
  const isBot = entry.kind === "bot";
  const name = isBot ? "Kasa Bot" : entry.author?.id === viewerId ? "You" : (entry.author?.name ?? "");
  const rotate = tiltFor(entry.id);

  let object: ReactNode;
  if (entry.kind === "note" || entry.kind === "decision") {
    const text = entry.body ?? "";
    object = (
      <Note text={text} rotate={rotate}>
        <Linkified text={text} />
      </Note>
    );
  } else if (isBot) {
    object = (
      <BotCard rotate={rotate} header={false}>
        {entry.body}
      </BotCard>
    );
  } else if (entry.kind === "photo" && entry.photos.length > 0) {
    const [first] = entry.photos;
    const author = entry.author?.name ?? "someone";
    object = (
      <Polaroid
        src={`/api/media/${first!.uploadId}/thumb`}
        alt={entry.body ? entry.body : `Photo from ${author}`}
        caption={entry.body ?? undefined}
        moreCount={entry.photos.length > 1 ? entry.photos.length - 1 : undefined}
        rotate={rotate}
        imageHeight={first!.width && first!.height ? Math.round((174 * first!.height) / first!.width) : 130}
      />
    );
  } else if (entry.kind === "link" && entry.link) {
    object = (
      <a className={`kasa-object ${styles.link}`} href={entry.link.url} target="_blank" rel="noopener noreferrer nofollow ugc">
        <span className={styles.linkTitle}>{entry.link.title ?? hostOf(entry.link.url) ?? entry.link.url}</span>
        <span className={styles.linkUrl}>{entry.link.url}</span>
      </a>
    );
  } else {
    const line = previewLine(
      { kind: entry.kind, body: entry.body, authorId: null, authorName: null, linkTitle: entry.link?.title ?? null, pageUrl: entry.capture?.pageUrl ?? null },
      viewerId,
    );
    object = <p className={styles.fallback}>{line}</p>;
  }

  return (
    <article className={styles.entry} aria-label={`${name}, ${entry.kind}`}>
      {isBot ? (
        <span className={styles.botMark} aria-hidden="true">
          k
        </span>
      ) : entry.author ? (
        <Avatar person={entry.author} size={36} />
      ) : (
        <span className={styles.avatarBlank} aria-hidden="true" />
      )}
      <div className={styles.entryBody}>
        <div className={styles.meta}>
          <span className={styles.author}>{name}</span> · <Time iso={entry.createdAt} />
        </div>
        {object}
      </div>
    </article>
  );
}
