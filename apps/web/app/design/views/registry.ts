// The views in the preview (F-19), in the order the index lists them. Pure, so the client
// gallery and the server pages share it.

export interface ViewInfo {
  id: string;
  title: string;
  /** What to look at, shown in the gallery. */
  note: string;
  /** The design screen it matches. */
  design: string;
}

export const VIEWS: ViewInfo[] = [
  { id: "piles", title: "Your piles", note: "Group piles, a personal pile, unread counts, and the Archived section.", design: "Projects.dc.html" },
  {
    id: "feed",
    title: "Pile feed",
    note: "Every content type: notes, a long note, photos and an album, a link, a reply, reactions, a guest via Telegram, a deleted outline, a sorting receipt, and a Kasa Bot answer with ideas. Try the menu, replying, posting, the chips and a photo.",
    design: "Main.dc.html",
  },
  { id: "answering", title: "Kasa Bot answering", note: "The thinking card and the answering line above the composer.", design: "States.dc.html" },
  { id: "first-run", title: "First run", note: "My pile with Kasa Bot's welcome card.", design: "States.dc.html" },
  { id: "empty", title: "Empty pile", note: "A new pile with nothing in it yet.", design: "States.dc.html" },
  { id: "viewer", title: "Viewer", note: "A member who can view but not add.", design: "States.dc.html" },
  { id: "archived", title: "Archived", note: "An archived pile, as its owner sees it.", design: "States.dc.html" },
  { id: "invite", title: "Invite", note: "The invite page, signed out.", design: "Pages.dc.html" },
  { id: "invite-expired", title: "Invite expired", note: "An invite link that no longer works.", design: "Pages.dc.html" },
  { id: "unsubscribe", title: "Unsubscribe", note: "Where the link in every email lands.", design: "Pages.dc.html" },
];

export const isView = (id: string) => VIEWS.some((v) => v.id === id);
