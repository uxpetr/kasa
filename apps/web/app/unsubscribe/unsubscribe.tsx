"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import controls from "../controls.module.css";
import styles from "./unsubscribe.module.css";

type State = { status: "working" } | { status: "done"; projectId: string; projectName: string; muted: boolean } | { status: "error"; message: string };

async function post(token: string, muted: boolean): Promise<State> {
  const res = await fetch("/api/unsubscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, muted }),
  }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as { projectId: string; projectName: string; muted: boolean; error?: string } | null;
  if (!res?.ok || !body) return { status: "error", message: body?.error ?? "Something went wrong" };
  return { status: "done", ...body };
}

export function Unsubscribe({ token }: { token: string }) {
  const [state, setState] = useState<State>({ status: "working" });
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let live = true;
    void post(token, true).then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, [token]);

  async function toggle(muted: boolean) {
    setPending(true);
    setState(await post(token, muted));
    setPending(false);
  }

  return (
    <main className={styles.page} aria-busy={state.status === "working"}>
      <p className={styles.logo}>Kasa</p>
      {state.status === "error" ? (
        <p role="alert" className={controls.error}>
          {state.message}
        </p>
      ) : null}
      {state.status === "done" && state.muted ? (
        <>
          <h1 className={styles.title}>Emails muted</h1>
          <p className={styles.text}>You won&apos;t get emails about {state.projectName} anymore. Everything is still in the pile.</p>
          <div className={styles.actions}>
            <button type="button" className={controls.secondary} disabled={pending} onClick={() => toggle(false)}>
              Unmute
            </button>
            <Link href={`/projects/${state.projectId}`} className={controls.primary}>
              Open {state.projectName}
            </Link>
          </div>
        </>
      ) : null}
      {state.status === "done" && !state.muted ? (
        <>
          <h1 className={styles.title} role="status">
            Emails are on again for {state.projectName}.
          </h1>
          <div className={styles.actions}>
            <Link href={`/projects/${state.projectId}`} className={controls.primary}>
              Open {state.projectName}
            </Link>
          </div>
        </>
      ) : null}
    </main>
  );
}
