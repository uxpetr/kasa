"use client";

import { useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { IMAGE_TYPES, isImageType, MAX_UPLOAD_BYTES } from "@kasa/media/limits";
import { Avatar, Composer } from "@kasa/ui";
import type { FeedEntry } from "@/lib/entries";
import { activeMention, insertMention, KASA_BOT, matchMentions, mentionIds, type Mentionable } from "@/lib/mentions";
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

interface ComposerProps {
  projectId: string;
  projectName: string;
  viewerId: string;
  onSent: (entry: FeedEntry) => void;
  /** The entry being replied to (D-006), e.g. { label: "Mika's note" }. */
  replyTo?: { id: string; label: string } | null;
  onCancelReply?: () => void;
}

export function FeedComposer({ projectId, projectName, viewerId, onSent, replyTo = null, onCancelReply }: ComposerProps) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  // @mention autocomplete (D-164): members load on the first "@".
  const [members, setMembers] = useState<Mentionable[] | null>(null);
  const [picked, setPicked] = useState<Mentionable[]>([]);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const options = mention && members ? matchMentions([...members, KASA_BOT], mention.query) : [];
  const open = options.length > 0;

  function onTextChange(value: string) {
    setText(value);
    const caret = input.current?.selectionStart ?? value.length;
    const next = activeMention(value, caret);
    setMention(next);
    setActive(0);
    if (next && members === null) {
      setMembers([]);
      void fetch(`/api/projects/${projectId}/members`)
        .then((res) => (res.ok ? (res.json() as Promise<{ members: Mentionable[] }>) : { members: [] }))
        .then(({ members }) => setMembers(members.filter((m) => m.id !== viewerId).map(({ id, name }) => ({ id, name }))))
        .catch(() => setMembers(null));
    }
  }

  function pick(option: Mentionable) {
    if (!mention) return;
    const next = insertMention(text, mention, option);
    setText(next.text);
    setPicked((current) => [...current, option]);
    setMention(null);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(next.caret, next.caret);
    });
  }

  function onInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(options[active]!);
    } else if (e.key === "Escape") {
      // Close the list without also cancelling a reply.
      e.preventDefault();
      e.stopPropagation();
      setMention(null);
    }
  }
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);

  // Starting a reply puts the cursor in the composer.
  useEffect(() => {
    if (replyTo) root.current?.querySelector<HTMLInputElement>("input[type=text]")?.focus();
  }, [replyTo]);

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
        body: JSON.stringify({ text: value, uploadIds, mentions: mentionIds(value, picked), ...(replyTo ? { replyToId: replyTo.id } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as FeedEntry & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Couldn't send");
      setText("");
      setPicked([]);
      setMention(null);
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
    <div
      ref={root}
      className={styles.composer}
      onPaste={onPaste}
      onDrop={(e: DragEvent) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === "Escape" && replyTo) onCancelReply?.();
      }}
      data-dragging={dragging || undefined}
    >
      {replyTo ? (
        <div className={styles.replyBar}>
          <span>Replying to {replyTo.label}</span>
          <button type="button" aria-label="Cancel reply" onClick={onCancelReply} disabled={sending}>
            ×
          </button>
        </div>
      ) : null}
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
      {open ? (
        <ul id={listId} role="listbox" aria-label="Mention someone" className={styles.mentions}>
          {options.map((option, i) => (
            <li
              key={option.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(option);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span aria-hidden="true">
                <Avatar person={option} size={24} />
              </span>
              <span>{option.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <Composer
        label={replyTo ? `Reply to ${replyTo.label}` : `Add to ${projectName}`}
        placeholder="Paste a link, drop a photo, write a note, or ask @kasa"
        value={text}
        onChange={onTextChange}
        inputRef={input}
        inputProps={{
          role: "combobox",
          "aria-autocomplete": "list",
          "aria-expanded": open,
          "aria-controls": open ? listId : undefined,
          "aria-activedescendant": open ? `${listId}-${active}` : undefined,
          onKeyDown: onInputKeyDown,
          onBlur: () => setMention(null),
        }}
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
