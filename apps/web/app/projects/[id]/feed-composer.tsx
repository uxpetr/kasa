"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { IMAGE_TYPES, isImageType, MAX_UPLOAD_BYTES } from "@kasa/media/limits";
import { Composer } from "@kasa/ui";
import type { FeedEntry } from "@/lib/entries";
import controls from "../../controls.module.css";
import styles from "./feed.module.css";

const MAX_PHOTOS = 10; // MAX_PHOTOS_PER_ENTRY on the server
const ACCEPT = Object.keys(IMAGE_TYPES).join(",");

interface Attachment {
  id: string;
  file: File;
  preview: string;
}

/** Uploads one image through F-06 and waits for the worker to finish it. Returns the upload id. */
async function uploadImage(projectId: string, file: File): Promise<string> {
  const json = async (res: Response) => {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(body.error ?? "Upload failed");
    return body as Record<string, unknown>;
  };
  const created = await json(
    await fetch("/api/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, contentType: file.type, size: file.size }),
    }),
  );
  const put = await fetch(created.uploadUrl as string, { method: "PUT", body: file, headers: created.headers as Record<string, string> });
  if (!put.ok) throw new Error("Upload failed");
  const uploadId = created.uploadId as string;
  await json(await fetch(`/api/uploads/${uploadId}/complete`, { method: "POST" }));

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { status } = await json(await fetch(`/api/uploads/${uploadId}`));
    if (status === "ready") return uploadId;
    if (status === "failed") throw new Error("That file isn't an image we can use");
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Upload is taking too long");
}

export function FeedComposer({ projectId, projectName, onSent }: { projectId: string; projectName: string; onSent: (entry: FeedEntry) => void }) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Drop images anywhere on the page.
  useEffect(() => {
    const over = (e: globalThis.DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        setDragging(true);
      }
    };
    const leave = (e: globalThis.DragEvent) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const drop = (e: globalThis.DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      setDragging(false);
      add(e.dataTransfer.files);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  });

  useEffect(() => () => attachments.forEach((a) => URL.revokeObjectURL(a.preview)), [attachments]);

  function add(files: FileList | File[]) {
    setError(null);
    const next: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (!isImageType(file.type)) {
        setError("Unsupported file type");
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setError("File too large");
        continue;
      }
      next.push({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file) });
    }
    setAttachments((current) => {
      const all = [...current, ...next];
      if (all.length > MAX_PHOTOS) setError(`At most ${MAX_PHOTOS} photos per message`);
      return all.slice(0, MAX_PHOTOS);
    });
  }

  async function send(value: string) {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const uploadIds = await Promise.all(attachments.map((a) => uploadImage(projectId, a.file)));
      const res = await fetch(`/api/projects/${projectId}/entries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: value, uploadIds }),
      });
      const body = (await res.json().catch(() => ({}))) as FeedEntry & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Couldn't send");
      setText("");
      setAttachments([]);
      onSent(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send");
    } finally {
      setSending(false);
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (images.length) {
      e.preventDefault();
      add(images);
    }
  };

  return (
    <div className={styles.composer} onPaste={onPaste} onDrop={(e: DragEvent) => e.preventDefault()} data-dragging={dragging || undefined}>
      {attachments.length ? (
        <ul className={styles.attachments}>
          {attachments.map((a) => (
            <li key={a.id}>
              <img src={a.preview} alt={a.file.name} />
              <button
                type="button"
                aria-label={`Remove ${a.file.name}`}
                disabled={sending}
                onClick={() => setAttachments((current) => current.filter((x) => x.id !== a.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Composer
        label={`Add to ${projectName}`}
        placeholder="Paste a link, drop a photo, write a note, or ask @kasa"
        value={text}
        onChange={setText}
        onSubmit={send}
        onAttach={() => fileInput.current?.click()}
        canSubmitEmpty={attachments.length > 0}
        disabled={sending}
      />
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) add(e.target.files);
          e.target.value = "";
        }}
      />
      {error ? (
        <p role="alert" className={controls.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
