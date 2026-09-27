"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@kasa/ui";
import { authClient } from "@/lib/auth-client";
import controls from "../../controls.module.css";
import styles from "./invite.module.css";

type State =
  | { status: "open"; projectName: string; memberCount: number; inviterName: string; avatars: { id: string; initial: string }[] }
  | { status: "expired" }
  | { status: "unknown" };

interface Props {
  token: string;
  state: State;
  signedIn?: boolean;
  /** Back from signing in through "Sign in with Google to join": join straight away. */
  autoJoin?: boolean;
}

export function InviteView({ token, state, signedIn = false, autoJoin = false }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function join() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/invites/${token}/accept`, { method: "POST" }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { projectId?: string; error?: string } | null;
    if (res?.ok && body?.projectId) return router.replace(`/projects/${body.projectId}`);
    setPending(false);
    // The link may have stopped working since the page loaded.
    if (res?.status === 410 || res?.status === 404) return router.refresh();
    setError(body?.error ?? "Something went wrong");
  }

  useEffect(() => {
    if (autoJoin && signedIn && state.status === "open" && !started.current) {
      started.current = true;
      void join();
    }
  });

  if (state.status !== "open") {
    const expired = state.status === "expired";
    return (
      <main className={styles.page}>
        <p className={styles.logo}>Kasa</p>
        <h1 className={styles.title}>{expired ? "This invite has expired" : "This invite link doesn't work"}</h1>
        <p className={styles.text}>{expired ? "Ask the person who sent it for a new link." : "Check that you copied the whole link."}</p>
        <div className={styles.actions}>
          <Link href="/" className={controls.primary}>
            Go to Kasa
          </Link>
        </div>
      </main>
    );
  }

  const people = state.memberCount === 1 ? "1 person is" : `${state.memberCount} people are`;
  return (
    <main className={styles.page}>
      <p className={styles.logo}>Kasa</p>
      <div className={styles.avatars} aria-hidden="true">
        {state.avatars.map((a) => (
          <Avatar key={a.id} person={{ id: a.id, name: a.initial }} size={44} />
        ))}
      </div>
      <h1 className={styles.title}>Join {state.projectName}</h1>
      <p className={styles.text}>
        {state.inviterName} invited you. {people} in this pile.
      </p>
      {error ? (
        <p role="alert" className={controls.error}>
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        {signedIn ? (
          <button type="button" className={controls.primary} disabled={pending} onClick={() => void join()}>
            Join pile
          </button>
        ) : (
          <button
            type="button"
            className={controls.primary}
            disabled={pending}
            onClick={async () => {
              setPending(true);
              await authClient.signIn.social({ provider: "google", callbackURL: `/invite/${token}?join=1` });
            }}
          >
            Sign in with Google to join
          </button>
        )}
      </div>
      <p className={styles.small}>You&apos;ll join as an editor.</p>
    </main>
  );
}
