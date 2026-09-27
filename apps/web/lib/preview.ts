// Wording for entries outside the feed (D-145). Pure, so browser code can use it too.
export type EntryKind = "note" | "photo" | "link" | "capture" | "drawing" | "file" | "decision" | "bot";

export interface LastEntry {
  kind: EntryKind;
  body: string | null;
  authorId: string | null;
  authorName: string | null;
  linkTitle: string | null;
  pageUrl: string | null;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** "Name: text" for notes and bot messages, "Name: what it is" otherwise (D-145). */
export function previewLine(entry: LastEntry, viewerId: string): string {
  const who =
    entry.kind === "bot" ? "Kasa Bot" : entry.authorId === viewerId ? "You" : entry.authorName ? firstName(entry.authorName) : null;
  const text = entry.body?.replace(/\s+/g, " ").trim() || null;
  const host = entry.pageUrl ? hostOf(entry.pageUrl) : null;
  const what: Record<EntryKind, string> = {
    note: text ?? "Note",
    bot: text ?? "Note",
    decision: text ?? "Decision",
    photo: "Photo",
    link: entry.linkTitle ? `Link · ${entry.linkTitle}` : "Link",
    capture: host ? `Capture from ${host}` : "Capture",
    drawing: host ? `Drawing on ${host}` : "Drawing",
    file: "File",
  };
  return who ? `${who}: ${what[entry.kind]}` : what[entry.kind];
}

