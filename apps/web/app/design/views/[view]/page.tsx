import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PERSONAL_PROJECT_NAME } from "@/lib/projects";
import { InviteView } from "../../../invite/[token]/invite-view";
import { PilesScreen } from "../../../piles-screen";
import { ProjectFeed } from "../../../projects/[id]/project-feed";
import { Unsubscribe } from "../../../unsubscribe/unsubscribe";
import { answeringEntries, EMPTY_PILE_ID, entriesFor, MY_PILE_ID, page, people, PILE_ID, PILE_NAME, piles } from "../fixtures";
import { PreviewGate } from "../preview-gate";

export const metadata: Metadata = { title: "Kasa views", robots: { index: false } };

type Role = "owner" | "editor" | "viewer";
const ownerCan = { post: true, rename: true, archive: true, manageMembers: true, leave: false, invite: true, editCategories: true, telegram: true };
const viewerCan = { post: false, rename: false, archive: false, manageMembers: false, leave: true, invite: false, editCategories: false, telegram: false };

function feed(projectId: string, name: string, role: Role, entries = entriesFor(projectId, Date.now()), archived = false) {
  const can = role === "owner" ? (archived ? { ...ownerCan, post: false, editCategories: false } : ownerCan) : viewerCan;
  return (
    <ProjectFeed
      project={{ id: projectId, name, archived }}
      viewer={{ ...people.you, role, emailsMuted: false }}
      can={can}
      initialPage={page(entries, { withCategories: projectId === PILE_ID })}
    />
  );
}

/** One view of the app with sample data (F-19), on its own so it can be framed at any width. */
export default async function ViewPage(props: PageProps<"/design/views/[view]">) {
  await connection(); // Sample times are relative to now.
  const { view } = await props.params;
  const now = Date.now();
  let content;
  switch (view) {
    case "piles":
      content = <PilesScreen user={people.you} piles={piles(now)} telegram={{ available: true, linked: false }} />;
      break;
    case "feed":
      content = feed(PILE_ID, PILE_NAME, "owner");
      break;
    case "answering":
      content = feed(PILE_ID, PILE_NAME, "owner", answeringEntries(now));
      break;
    case "first-run":
      content = feed(MY_PILE_ID, PERSONAL_PROJECT_NAME, "owner");
      break;
    case "empty":
      content = feed(EMPTY_PILE_ID, "Osaka food crawl", "owner");
      break;
    case "viewer":
      content = feed(PILE_ID, PILE_NAME, "viewer");
      break;
    case "archived":
      content = feed(PILE_ID, PILE_NAME, "owner", undefined, true);
      break;
    case "invite":
      content = (
        <InviteView
          token="preview"
          state={{
            status: "open",
            projectName: PILE_NAME,
            memberCount: 4,
            inviterName: people.mika.name,
            avatars: [people.mika, people.you, people.aiko, people.jun].map((p) => ({ id: p.id, initial: p.name[0]! })),
          }}
        />
      );
      break;
    case "invite-expired":
      content = <InviteView token="preview" state={{ status: "expired" }} />;
      break;
    case "unsubscribe":
      content = <Unsubscribe token="preview" />;
      break;
    default:
      notFound();
  }
  return <PreviewGate>{content}</PreviewGate>;
}
