import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq, schema } from "@kasa/db";
import { projectAccess } from "@/lib/access";
import { getAuth, isAuthConfigured } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { isUuid } from "@/lib/result";
import styles from "../../piles.module.css";

// Placeholder so project links work; the zen chat feed replaces it in P-03.
export default async function ProjectPage(props: PageProps<"/projects/[id]">) {
  const { id } = await props.params;
  const session = isAuthConfigured() ? await getAuth().api.getSession({ headers: await headers() }) : null;
  if (!session) redirect("/");
  // Members only; everyone else gets the same 404 as a missing project.
  if (!isUuid(id) || !(await projectAccess(getDb(), session.user.id, id))) notFound();
  const [project] = await getDb().select({ name: schema.projects.name }).from(schema.projects).where(eq(schema.projects.id, id));

  return (
    <main className={styles.page}>
      <Link href="/" className={styles.back}>
        ← Your piles
      </Link>
      <h1 className={styles.title}>{project!.name}</h1>
    </main>
  );
}
