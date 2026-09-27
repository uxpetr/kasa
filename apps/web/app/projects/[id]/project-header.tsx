"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Avatar } from "@kasa/ui";
import type { FeedProps } from "./project-feed";
import controls from "../../controls.module.css";
import styles from "./feed.module.css";

type Member = { id: string; name: string; role: "owner" | "editor" | "viewer" };

const ROLE_LABEL = { owner: "Owner", editor: "Editor", viewer: "Viewer" } as const;

/** Back, the project name, and the project menu (D-008, D-148). */
export function ProjectHeader({ project, viewer, can }: Pick<FeedProps, "project" | "viewer" | "can">) {
  const router = useRouter();
  const members = useRef<HTMLDialogElement>(null);
  const rename = useRef<HTMLDialogElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [memberList, setMemberList] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [muted, setMuted] = useState(viewer.emailsMuted);

  const closeMenu = () => menu.current?.hidePopover();

  async function patch(body: { name?: string; archived?: boolean }) {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setPending(false);
    if (res?.ok) return true;
    setError(res ? (((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Something went wrong") : "Something went wrong");
    return false;
  }

  async function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "");
    if (await patch({ name })) {
      rename.current?.close();
      router.refresh();
    }
  }

  return (
    <header className={styles.header}>
      <Link href="/" className={styles.iconButton} aria-label="Back to your piles">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </Link>
      <h1 className={styles.title}>{project.name}</h1>
      <button type="button" className={styles.iconButton} popoverTarget="project-menu" aria-label="Project menu">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>

      <div id="project-menu" popover="auto" ref={menu} className={controls.menu} role="menu">
        <button
          type="button"
          role="menuitem" className={controls.menuItem}
          onClick={async () => {
            closeMenu();
            members.current?.showModal();
            const res = await fetch(`/api/projects/${project.id}/members`).catch(() => null);
            if (res?.ok) setMemberList(((await res.json()) as { members: Member[] }).members);
          }}
        >
          Members
        </button>
        {can.rename ? (
          <button
            type="button"
            role="menuitem" className={controls.menuItem}
            onClick={() => {
              closeMenu();
              setError(null);
              rename.current?.showModal();
            }}
          >
            Rename
          </button>
        ) : null}
        {can.archive ? (
          <button
            type="button"
            role="menuitem" className={controls.menuItem}
            disabled={pending}
            onClick={async () => {
              closeMenu();
              if (await patch({ archived: !project.archived })) window.location.reload();
            }}
          >
            {project.archived ? "Unarchive" : "Archive"}
          </button>
        ) : null}
        <button
          type="button"
          role="menuitem" className={controls.menuItem}
          onClick={async () => {
            closeMenu();
            const res = await fetch(`/api/projects/${project.id}/email-mute`, {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ muted: !muted }),
            }).catch(() => null);
            if (res?.ok) setMuted(((await res.json()) as { muted: boolean }).muted);
          }}
        >
          {muted ? "Unmute emails" : "Mute emails"}
        </button>
        <button type="button" role="menuitem" className={controls.menuItem} disabled>
          Search (coming soon)
        </button>
      </div>

      <dialog ref={members} className={controls.dialog} aria-labelledby="members-title">
        <h2 id="members-title">Members</h2>
        <ul className={styles.members} aria-busy={memberList === null}>
          {(memberList ?? []).map((m) => (
            <li key={m.id}>
              <Avatar person={m} size={32} />
              <span className={styles.memberName}>{m.name}</span>
              <span className={styles.memberRole}>{ROLE_LABEL[m.role]}</span>
            </li>
          ))}
        </ul>
        <div className={controls.actions}>
          <button type="button" className={controls.secondary} onClick={() => members.current?.close()}>
            Close
          </button>
        </div>
      </dialog>

      <dialog ref={rename} className={controls.dialog} aria-labelledby="rename-title">
        <form onSubmit={submitRename}>
          <h2 id="rename-title">Rename</h2>
          <label className={controls.field}>
            Name
            <input name="name" required maxLength={80} defaultValue={project.name} autoComplete="off" />
          </label>
          {error ? (
            <p role="alert" className={controls.error}>
              {error}
            </p>
          ) : null}
          <div className={controls.actions}>
            <button type="button" className={controls.secondary} onClick={() => rename.current?.close()}>
              Cancel
            </button>
            <button type="submit" className={controls.primary} disabled={pending}>
              Save
            </button>
          </div>
        </form>
      </dialog>
      {error && !pending ? (
        <p role="alert" className={styles.headerError}>
          {error}
        </p>
      ) : null}
    </header>
  );
}
