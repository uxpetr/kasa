import type { Metadata } from "next";
import { Gallery } from "./gallery";
import styles from "./views.module.css";

export const metadata: Metadata = { title: "Kasa views", robots: { index: false } };

/**
 * The key views with sample data (F-19), for checking token and component changes across the app.
 * Each view is the real component, framed at phone and desktop width.
 */
export default function ViewsPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>Kasa views</h1>
        <p>
          The real screens with sample data. Change a token or a component, then reload. Nothing here is saved.{" "}
          <a href="/design">Components</a>
        </p>
      </header>
      <Gallery />
    </main>
  );
}
