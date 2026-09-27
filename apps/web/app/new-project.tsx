"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import styles from "./controls.module.css";

/**
 * "+ New project": a small dialog for the name, then opens the new project (D-143).
 * `trigger` swaps the button, e.g. for the welcome card's "Start a pile" (D-180).
 */
export function NewProject({ trigger }: { trigger?: (open: () => void) => ReactNode } = {}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get("name");
    setPending(true);
    setError(null);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    if (res?.ok) {
      const project = (await res.json()) as { id: string };
      router.push(`/projects/${project.id}`);
      return;
    }
    setPending(false);
    setError(res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Something went wrong" : "Something went wrong");
  }

  function open() {
    setError(null);
    dialog.current?.showModal();
  }

  return (
    <>
      {trigger ? (
        trigger(open)
      ) : (
        <button type="button" className={styles.primary} onClick={open}>
          + New project
        </button>
      )}
      <dialog ref={dialog} className={styles.dialog} aria-labelledby="new-project-title">
        <form onSubmit={create}>
          <h2 id="new-project-title">New project</h2>
          <label className={styles.field}>
            Name
            <input name="name" required maxLength={80} autoComplete="off" autoFocus />
          </label>
          {error ? (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          ) : null}
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button type="submit" className={styles.primary} disabled={pending}>
              Create
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
