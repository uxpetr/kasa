import Link from "next/link";
import { Pile as PileCard } from "@kasa/ui";
import type { Pile } from "@/lib/piles";
import { AccountMenu } from "./account-menu";
import { NewProject } from "./new-project";
import { RelativeTime } from "./relative-time";
import styles from "./piles.module.css";

/** "Your piles" (P-02, design/prototype/Projects.dc.html). */
export function PilesScreen({ user, piles }: { user: { id: string; name: string }; piles: Pile[] }) {
  const active = piles.filter((p) => !p.archivedAt);
  const archived = piles.filter((p) => p.archivedAt);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.logo}>kasa</div>
        <div className={styles.headerActions}>
          <NewProject />
          <AccountMenu user={user} />
        </div>
      </header>
      <h1 className={styles.title}>Your piles</h1>
      <Grid piles={active} userId={user.id} />
      {archived.length > 0 ? (
        <details className={styles.archived}>
          <summary>Archived ({archived.length})</summary>
          <Grid piles={archived} userId={user.id} />
        </details>
      ) : null}
    </main>
  );
}

function Grid({ piles, userId }: { piles: Pile[]; userId: string }) {
  return (
    <ul className={styles.grid}>
      {piles.map((p) => {
        const personal = p.memberCount === 1 && p.members[0]?.id === userId;
        return (
          <li key={p.id}>
            <PileCard
              id={p.id}
              href={`/projects/${p.id}`}
              link={Link}
              title={p.name}
              // A personal pile says how much is in it, as in the prototype.
              preview={personal ? (p.entryCount > 0 ? `Just you · ${p.entryCount} ${p.entryCount === 1 ? "thing" : "things"} saved` : "Just you") : (p.preview ?? undefined)}
              unread={p.unread}
              members={p.members}
              meta={<RelativeTime iso={p.activeAt.toISOString()} />}
              peek={p.peekUrl ? { src: p.peekUrl, alt: "" } : undefined}
              personal={personal}
              archived={p.archivedAt !== null}
            />
          </li>
        );
      })}
    </ul>
  );
}
