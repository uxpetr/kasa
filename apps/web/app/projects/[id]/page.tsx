import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { eq, schema } from "@kasa/db";
import { canAdd, canArchive, canRename, projectAccess } from "@/lib/access";
import { getAuth, isAuthConfigured } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listEntries } from "@/lib/entries";
import { emailsMuted } from "@/lib/notifications";
import { isUuid } from "@/lib/result";
import { ProjectFeed } from "./project-feed";

export async function generateMetadata(props: PageProps<"/projects/[id]">) {
  const { id } = await props.params;
  if (!isUuid(id)) return { title: "Kasa" };
  const [project] = await getDb().select({ name: schema.projects.name }).from(schema.projects).where(eq(schema.projects.id, id));
  // The name is only shown to members; everyone else sees the plain title.
  const session = isAuthConfigured() ? await getAuth().api.getSession({ headers: await headers() }) : null;
  const member = session && project ? await projectAccess(getDb(), session.user.id, id) : null;
  return { title: member ? `${project!.name} · Kasa` : "Kasa" };
}

/** Zen mode (D-008): only the feed and the composer, with back, the name, and a menu. */
export default async function ProjectPage(props: PageProps<"/projects/[id]">) {
  const { id } = await props.params;
  const session = isAuthConfigured() ? await getAuth().api.getSession({ headers: await headers() }) : null;
  if (!session) redirect("/");
  const userId = session.user.id;
  // Members only; everyone else gets the same 404 as a missing project.
  const access = isUuid(id) ? await projectAccess(getDb(), userId, id) : null;
  if (!access) notFound();

  const [[project], page, muted] = await Promise.all([
    getDb().select({ name: schema.projects.name }).from(schema.projects).where(eq(schema.projects.id, id)),
    listEntries(getDb(), userId, id),
    emailsMuted(getDb(), userId, id),
  ]);
  if (!page.ok) notFound();

  return (
    <ProjectFeed
      project={{ id, name: project!.name, archived: access.archived }}
      viewer={{ id: userId, name: session.user.name, role: access.role, emailsMuted: muted }}
      can={{ post: canAdd(access), rename: canRename(access), archive: canArchive(access) }}
      initialPage={page.value}
    />
  );
}
