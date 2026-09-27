import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getAuth, isAuthConfigured } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { isPilotAdmin, listFeedback } from "@/lib/feedback";
import styles from "./feedback.module.css";

export const metadata: Metadata = { title: "Feedback · Kasa", robots: { index: false } };

/** Pilot feedback for Petr (D-181); everyone not in PILOT_ADMIN_EMAILS gets a 404. */
export default async function FeedbackPage() {
  await connection();
  const session = isAuthConfigured() ? await getAuth().api.getSession({ headers: await headers() }) : null;
  if (!isPilotAdmin(session?.user.email)) notFound();
  const items = await listFeedback(getDb());

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Feedback</h1>
      {items.length === 0 ? <p className={styles.empty}>Nothing yet.</p> : null}
      <ol className={styles.list}>
        {items.map((f) => (
          <li key={f.id} className={styles.item}>
            <p className={styles.meta}>
              {f.author ? `${f.author.name} (${f.author.email})` : "A deleted user"} ·{" "}
              <time dateTime={f.createdAt.toISOString()}>{f.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</time>
              {f.page ? ` · ${f.page}` : null}
            </p>
            <p className={styles.body}>{f.body}</p>
          </li>
        ))}
      </ol>
    </main>
  );
}
