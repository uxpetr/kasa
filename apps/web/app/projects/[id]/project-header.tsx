"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Avatar } from "@kasa/ui";
import type { FeedProps } from "./project-feed";
import controls from "../../controls.module.css";
import styles from "./feed.module.css";

type Member = { id: string; name: string; role: "owner" | "editor" | "viewer" };

const ROLE_LABEL = { owner: "Owner", editor: "Editor", viewer: "Viewer" } as const;
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

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
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const [confirm, setConfirm] = useState<{ kind: "remove"; member: Member } | { kind: "leave" } | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  // Invite people (D-176): undefined while loading, null when there's no live link.
  const invite = useRef<HTMLDialogElement>(null);
  const [inviteLink, setInviteLink] = useState<string | null | undefined>(undefined);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function inviteRequest(method: "GET" | "POST" | "DELETE") {
    setPending(true);
    setInviteError(null);
    setCopied(false);
    const res = await fetch(`/api/projects/${project.id}/invites`, { method }).catch(() => null);
    setPending(false);
    const body = (await res?.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (!res?.ok) return setInviteError(body?.error ?? "Something went wrong");
    setInviteLink(method === "DELETE" ? null : (body?.url ?? null));
  }
  const loadInvite = () => inviteRequest("GET");

  // The confirmation opens over the Members dialog.
  useEffect(() => {
    if (confirm) {
      setMemberError(null);
      confirmDialog.current?.showModal();
    }
  }, [confirm]);

  async function memberRequest(memberId: string, init: RequestInit) {
    setPending(true);
    setMemberError(null);
    const res = await fetch(`/api/projects/${project.id}/members/${memberId}`, init).catch(() => null);
    setPending(false);
    if (res?.ok) return true;
    setMemberError(res ? (((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Something went wrong") : "Something went wrong");
    return false;
  }

  async function changeRole(member: Member, role: "editor" | "viewer") {
    const ok = await memberRequest(member.id, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (ok) setMemberList((list) => list?.map((m) => (m.id === member.id ? { ...m, role } : m)) ?? null);
  }

  async function confirmAction() {
    if (!confirm) return;
    const memberId = confirm.kind === "remove" ? confirm.member.id : viewer.id;
    if (!(await memberRequest(memberId, { method: "DELETE" }))) return;
    if (confirm.kind === "leave") {
      router.replace("/"); // D-171
      return;
    }
    setMemberList((list) => list?.filter((m) => m.id !== memberId) ?? null);
    confirmDialog.current?.close();
    setConfirm(null);
  }

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
        {can.invite ? (
          <button
            type="button"
            role="menuitem" className={controls.menuItem}
            onClick={() => {
              closeMenu();
              invite.current?.showModal();
              void loadInvite();
            }}
          >
            Invite people
          </button>
        ) : null}
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
              {can.manageMembers && m.role !== "owner" ? (
                <>
                  <select
                    className={styles.memberRoleSelect}
                    aria-label={`Role for ${m.name}`}
                    value={m.role}
                    disabled={pending}
                    onChange={(e) => void changeRole(m, e.target.value as "editor" | "viewer")}
                  >
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button type="button" className={styles.memberRemove} onClick={() => setConfirm({ kind: "remove", member: m })}>
                    Remove
                  </button>
                </>
              ) : (
                <span className={styles.memberRole}>{ROLE_LABEL[m.role]}</span>
              )}
            </li>
          ))}
        </ul>
        {memberError && !confirm ? (
          <p role="alert" className={controls.error}>
            {memberError}
          </p>
        ) : null}
        <div className={controls.actions}>
          {can.leave ? (
            <button type="button" className={controls.secondary} onClick={() => setConfirm({ kind: "leave" })}>
              Leave this pile
            </button>
          ) : null}
          <button type="button" className={controls.secondary} onClick={() => members.current?.close()}>
            Close
          </button>
        </div>
      </dialog>

      <dialog ref={invite} className={controls.dialog} aria-labelledby="invite-title" onClose={() => setCopied(false)}>
        <h2 id="invite-title">Invite people</h2>
        <p>Anyone with this link can join as an editor. It works for 7 days.</p>
        {inviteLink ? (
          <label className={controls.field}>
            <span className="kasa-visually-hidden">Invite link</span>
            <input readOnly value={inviteLink} onFocus={(e) => e.currentTarget.select()} />
          </label>
        ) : null}
        {inviteError ? (
          <p role="alert" className={controls.error}>
            {inviteError}
          </p>
        ) : null}
        <div className={`${controls.actions} ${styles.inviteActions}`}>
          {inviteLink ? (
            <>
              <button type="button" className={controls.secondary} disabled={pending} onClick={() => void inviteRequest("DELETE")}>
                Turn off link
              </button>
              <button type="button" className={controls.secondary} disabled={pending} onClick={() => void inviteRequest("POST")}>
                New link
              </button>
              <button
                type="button"
                className={controls.primary}
                onClick={async () => {
                  await navigator.clipboard.writeText(inviteLink).then(
                    () => setCopied(true),
                    () => setInviteError("Couldn't copy; select the link and copy it"),
                  );
                }}
              >
                {copied ? "Copied" : "Copy link"}
              </button>
            </>
          ) : inviteLink === null ? (
            <button type="button" className={controls.primary} disabled={pending} onClick={() => void inviteRequest("POST")}>
              Create link
            </button>
          ) : null}
          <button type="button" className={controls.secondary} onClick={() => invite.current?.close()}>
            Close
          </button>
        </div>
      </dialog>

      <dialog
        ref={confirmDialog}
        className={controls.dialog}
        aria-labelledby="member-confirm-title"
        onClose={() => !pending && setConfirm(null)}
      >
        {confirm ? (
          <>
            <h2 id="member-confirm-title">
              {confirm.kind === "remove" ? `Remove ${firstName(confirm.member.name)} from ${project.name}?` : `Leave ${project.name}?`}
            </h2>
            <p>
              {confirm.kind === "remove"
                ? "Their entries stay in the pile."
                : "Your entries stay in the pile. You'll need a new invite to come back."}
            </p>
            {memberError ? (
              <p role="alert" className={controls.error}>
                {memberError}
              </p>
            ) : null}
            <div className={controls.actions}>
              <button type="button" className={controls.secondary} onClick={() => confirmDialog.current?.close()}>
                Cancel
              </button>
              <button type="button" className={controls.primary} disabled={pending} onClick={() => void confirmAction()}>
                {confirm.kind === "remove" ? "Remove" : "Leave"}
              </button>
            </div>
          </>
        ) : null}
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
