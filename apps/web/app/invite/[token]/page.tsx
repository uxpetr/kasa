import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth, isAuthConfigured } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { previewInvite } from "@/lib/projects";
import { InviteView } from "./invite-view";

async function load(token: string) {
  const session = isAuthConfigured() ? await getAuth().api.getSession({ headers: await headers() }) : null;
  return { session, preview: await previewInvite(getDb(), session?.user.id ?? null, token) };
}

export async function generateMetadata(props: PageProps<"/invite/[token]">): Promise<Metadata> {
  const { token } = await props.params;
  const { preview } = await load(token);
  return { title: preview.ok ? `Join ${preview.value.projectName} · Kasa` : "Kasa", robots: { index: false } };
}

/** The invite link (P-14, D-173 to D-175). Anyone with a working link sees what they'd join. */
export default async function InvitePage(props: PageProps<"/invite/[token]">) {
  const { token } = await props.params;
  const { join } = await props.searchParams;
  const { session, preview } = await load(token);
  if (preview.ok && preview.value.alreadyMember) redirect(`/projects/${preview.value.projectId}`);

  if (!preview.ok) return <InviteView token={token} state={{ status: preview.status === 410 ? "expired" : "unknown" }} />;
  const { projectName, memberCount, inviterName, avatars } = preview.value;
  return (
    <InviteView
      token={token}
      state={{ status: "open", projectName, memberCount, inviterName, avatars }}
      signedIn={Boolean(session)}
      autoJoin={join === "1"}
    />
  );
}
