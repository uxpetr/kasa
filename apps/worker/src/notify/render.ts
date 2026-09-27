// Notification emails, worded as approved in D-167.

export type EntryKind = "note" | "photo" | "link" | "capture" | "drawing" | "file" | "decision" | "bot";

export interface EmailEntry {
  kind: EntryKind;
  body: string | null;
}

export interface EmailItem {
  kind: "reply" | "mention";
  /** Null for Kasa Bot. */
  authorName: string | null;
  entry: EmailEntry;
  /** For replies: the recipient's entry that was answered. */
  original: EmailEntry | null;
}

export interface RenderInput {
  projectName: string;
  projectUrl: string;
  unsubscribeUrl: string;
  items: EmailItem[];
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export const MAX_ITEMS = 5;
export const MAX_SNIPPET = 140;

const NOUN: Record<EntryKind, string> = {
  note: "note",
  photo: "photo",
  link: "link",
  capture: "capture",
  drawing: "drawing",
  file: "file",
  decision: "decision",
  bot: "message",
};

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const who = (item: EmailItem) => (item.authorName ? firstName(item.authorName) : "Kasa Bot");

/** The entry's text, cut at 140 characters; "(a photo)" and so on when it has none. */
export function snippet(entry: EmailEntry): string {
  const text = entry.body?.replace(/\s+/g, " ").trim();
  if (!text) return `(a ${NOUN[entry.kind]})`;
  return text.length > MAX_SNIPPET ? `${text.slice(0, MAX_SNIPPET - 1).trimEnd()}…` : text;
}

export function subjectFor(projectName: string, items: EmailItem[]): string {
  if (items.length === 1) {
    const [item] = items as [EmailItem];
    return `${who(item)} ${item.kind === "reply" ? "replied to you" : "mentioned you"} in ${projectName}`;
  }
  const replies = items.filter((i) => i.kind === "reply").length;
  const mentions = items.length - replies;
  if (!mentions) return `${replies} replies in ${projectName}`;
  if (!replies) return `${mentions} mentions in ${projectName}`;
  return `${items.length} replies and mentions in ${projectName}`;
}

export const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const INK = "#1F1D1A";
const MUTED = "#6B665C";
const ACCENT = "#B3372A"; // --kasa-color-accent
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

function layout(input: RenderInput, heading: string, content: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(heading)}</title></head>
<body style="margin:0;padding:0;background:#FBFAF7;">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:${FONT};color:${INK};font-size:15px;line-height:1.5;">
<p style="margin:0 0 24px;font:600 22px/1 Georgia,serif;">Kasa</p>
<h1 style="margin:0 0 16px;font:600 20px/1.3 ${FONT};">${heading}</h1>
${content}
<p style="margin:24px 0 32px;"><a href="${escape(input.projectUrl)}" style="display:inline-block;padding:12px 20px;border-radius:22px;background:${ACCENT};color:#fff;font-weight:600;text-decoration:none;">Open ${escape(input.projectName)}</a></p>
<p style="margin:0;color:${MUTED};font-size:13px;">You're getting this because you're in ${escape(input.projectName)} on Kasa. <a href="${escape(input.unsubscribeUrl)}" style="color:${MUTED};">Mute emails from this pile</a></p>
</div></body></html>`;
}

export function renderEmail(input: RenderInput): RenderedEmail {
  const items = input.items;
  if (!items.length) throw new Error("Nothing to email");
  const subject = subjectFor(input.projectName, items);
  const footer = `You're getting this because you're in ${input.projectName} on Kasa. Mute emails from this pile: ${input.unsubscribeUrl}`;
  const button = `Open ${input.projectName}: ${input.projectUrl}`;

  if (items.length === 1) {
    const [item] = items as [EmailItem];
    const heading =
      item.kind === "reply" && item.original
        ? `${who(item)} replied to your ${NOUN[item.original.kind]}`
        : item.kind === "reply"
          ? `${who(item)} replied to you`
          : `${who(item)} mentioned you`;
    const quote =
      item.kind === "reply" && item.original
        ? `<p style="margin:0 0 12px;padding-left:12px;border-left:3px solid #D6D0C3;color:${MUTED};">${escape(snippet(item.original))}</p>`
        : "";
    const html = layout(input, escape(heading), `${quote}<p style="margin:0;">${escape(snippet(item.entry))}</p>`);
    const text = [heading, "", ...(item.kind === "reply" && item.original ? [`> ${snippet(item.original)}`] : []), snippet(item.entry), "", button, "", footer].join("\n");
    return { subject, html, text };
  }

  const heading = `${items.length} new for you in ${input.projectName}`;
  const shown = items.slice(0, MAX_ITEMS);
  const rest = items.length - shown.length;
  const line = (item: EmailItem) =>
    item.kind === "reply" ? `replied to your ${NOUN[item.original?.kind ?? "note"]}` : "mentioned you";
  const html = layout(
    input,
    escape(heading),
    shown.map((item) => `<p style="margin:0 0 12px;"><strong>${escape(who(item))}</strong> ${line(item)}: ${escape(snippet(item.entry))}</p>`).join("\n") +
      (rest > 0 ? `\n<p style="margin:0;color:${MUTED};">…and ${rest} more</p>` : ""),
  );
  const text = [
    heading,
    "",
    ...shown.map((item) => `${who(item)} ${line(item)}: ${snippet(item.entry)}`),
    ...(rest > 0 ? [`…and ${rest} more`] : []),
    "",
    button,
    "",
    footer,
  ].join("\n");
  return { subject, html, text };
}
