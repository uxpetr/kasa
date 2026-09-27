"use client";

import { useEffect, useRef, useState } from "react";
import type { FeedEntry } from "@/lib/entries";
import controls from "../../controls.module.css";
import styles from "./feed.module.css";

/** Full-size photos of one entry; arrows, keys, or a swipe move through the stack. */
export function PhotoViewer({ entry, alt, onClose }: { entry: FeedEntry; alt: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const swipe = useRef<number | null>(null);
  const [index, setIndex] = useState(0);
  const count = entry.photos.length;
  const photo = entry.photos[index]!;
  const go = (step: number) => setIndex((i) => (i + step + count) % count);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className={styles.viewer}
      aria-label={count > 1 ? `Photo ${index + 1} of ${count}` : "Photo"}
      onClose={onClose}
      onKeyDown={(e) => {
        if (count < 2) return;
        if (e.key === "ArrowRight") go(1);
        if (e.key === "ArrowLeft") go(-1);
      }}
      onClick={(e) => e.target === dialog.current && dialog.current.close()}
    >
      <img
        key={photo.uploadId}
        src={`/api/media/${photo.uploadId}/full`}
        alt={alt}
        width={photo.width ?? undefined}
        height={photo.height ?? undefined}
        onPointerDown={(e) => (swipe.current = e.clientX)}
        onPointerUp={(e) => {
          if (swipe.current === null || count < 2) return;
          const dx = e.clientX - swipe.current;
          swipe.current = null;
          if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        }}
      />
      <div className={styles.viewerBar}>
        {count > 1 ? (
          <>
            <button type="button" className={controls.secondary} onClick={() => go(-1)} aria-label="Previous photo">
              ←
            </button>
            <span aria-live="polite">
              {index + 1} of {count}
            </span>
            <button type="button" className={controls.secondary} onClick={() => go(1)} aria-label="Next photo">
              →
            </button>
          </>
        ) : null}
        <button type="button" className={controls.secondary} onClick={() => dialog.current?.close()} autoFocus>
          Close
        </button>
      </div>
    </dialog>
  );
}
