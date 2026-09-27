"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import styles from "./controls.module.css";

const MAX_LENGTH = 4000;

/**
 * "Send feedback" (D-181): a text box and Send, then a thank-you. Returns the opener and the
 * dialog separately, so the dialog can live outside the account menu's popover, which hides it.
 */
export function useFeedbackDialog(): [open: () => void, dialog: ReactNode] {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<"editing" | "sending" | "sent">("editing");
  const [error, setError] = useState<string | null>(null);

  function open() {
    setState("editing");
    setError(null);
    dialog.current?.showModal();
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setState("sending");
    setError(null);
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: new FormData(form).get("text"), page: window.location.pathname }),
    }).catch(() => null);
    if (res?.ok) {
      form.reset();
      setState("sent");
      return;
    }
    setState("editing");
    setError(res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Something went wrong" : "Something went wrong");
  }

  return [
    open,
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="feedback-title">
      {state === "sent" ? (
        <>
          <h2 id="feedback-title">Thanks! Petr reads every one.</h2>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => dialog.current?.close()} autoFocus>
              Close
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={send}>
          <h2 id="feedback-title">What&apos;s working, what isn&apos;t?</h2>
          <textarea name="text" className={styles.textarea} aria-labelledby="feedback-title" required maxLength={MAX_LENGTH} autoFocus />
          {error ? (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          ) : null}
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button type="submit" className={styles.primary} disabled={state === "sending"}>
              Send
            </button>
          </div>
        </form>
      )}
    </dialog>,
  ];
}
