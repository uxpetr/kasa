"use client";

import { useEffect, useRef, useState } from "react";
import controls from "../../controls.module.css";

interface State {
  linked: { title: string | null } | null;
}

/**
 * The pile's Telegram dialog (P-18, D-207): "Add Kasa Bot to a group" opens Telegram's group picker
 * with a one-time code; once the bot is in, the dialog shows the group with Unlink. Owner only.
 */
export function useTelegramDialog(projectId: string): [() => void, React.ReactNode] {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function load(): Promise<State | null> {
    const res = await fetch(`/api/projects/${projectId}/telegram`).catch(() => null);
    const next = res?.ok ? ((await res.json()) as State) : null;
    if (next) setState(next);
    return next;
  }

  // While it's open and not linked yet: a fresh link, and a check every few seconds for the bot joining.
  useEffect(() => {
    if (!open) return;
    let stopped = false;
    void (async () => {
      const now = await load();
      if (stopped || now?.linked) return;
      const res = await fetch(`/api/projects/${projectId}/telegram`, { method: "POST" }).catch(() => null);
      if (res?.ok) setUrl(((await res.json()) as { url: string }).url);
      else setError("Couldn't make a link. Try again.");
    })();
    const timer = window.setInterval(() => void load(), 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [open, projectId]);

  const linked = state?.linked;
  const node = (
    <dialog ref={dialog} className={controls.dialog} aria-labelledby="telegram-title" onClose={() => setOpen(false)}>
      <h2 id="telegram-title">Telegram</h2>
      {linked ? (
        <p>Linked to {linked.title ?? "a Telegram group"}</p>
      ) : (
        <p>Post this pile to a Telegram group, and the group to here.</p>
      )}
      {error ? (
        <p role="alert" className={controls.error}>
          {error}
        </p>
      ) : null}
      <div className={controls.actions}>
        {linked ? (
          <button
            type="button"
            className={controls.secondary}
            disabled={pending}
            onClick={async () => {
              setPending(true);
              const res = await fetch(`/api/projects/${projectId}/telegram`, { method: "DELETE" }).catch(() => null);
              setPending(false);
              if (res?.ok) {
                setState({ linked: null });
                setOpen(false);
                dialog.current?.close();
              } else setError("Couldn't unlink. Try again.");
            }}
          >
            Unlink
          </button>
        ) : url ? (
          <a className={controls.primary} href={url} target="_blank" rel="noopener noreferrer">
            Add Kasa Bot to a group
          </a>
        ) : null}
        <button type="button" className={controls.secondary} onClick={() => dialog.current?.close()}>
          Close
        </button>
      </div>
    </dialog>
  );
  const show = () => {
    setError(null);
    setUrl(null);
    setOpen(true);
    dialog.current?.showModal();
  };
  return [show, node];
}
