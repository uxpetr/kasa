// Reads a page's preview metadata: Open Graph, Twitter cards, <title>, and the oEmbed link (P-05).
import { Parser } from "htmlparser2";

export interface PageMeta {
  /** From Open Graph or Twitter tags. */
  title: string | null;
  /** From <title>, the last resort. */
  documentTitle: string | null;
  siteName: string | null;
  image: string | null;
  oembed: string | null;
}

export interface OembedMeta {
  title: string | null;
  siteName: string | null;
  image: string | null;
}

const MAX_TITLE = 300;
const MAX_SITE_NAME = 100;

function clean(value: string | undefined | null, max: number): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function absolute(value: string | undefined | null, base: URL): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim(), base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Only the document head is read; parsing stops at <body>. */
export function parsePage(html: string, base: URL): PageMeta {
  const meta = new Map<string, string>();
  let title = "";
  let inTitle = false;
  let titleDone = false;
  let oembed: string | undefined;
  let done = false;

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (done) return;
        if (name === "body") {
          done = true;
          return;
        }
        if (name === "title" && !titleDone) inTitle = true;
        if (name === "meta") {
          const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
          if (key && attrs.content !== undefined && !meta.has(key)) meta.set(key, attrs.content);
        }
        if (name === "link" && !oembed) {
          const rel = (attrs.rel ?? "").toLowerCase().split(/\s+/);
          if (rel.includes("alternate") && (attrs.type ?? "").toLowerCase() === "application/json+oembed") oembed = attrs.href;
        }
      },
      ontext(text) {
        if (inTitle) title += text;
      },
      onclosetag(name) {
        if (name === "title" && inTitle) {
          inTitle = false;
          titleDone = true;
        }
        if (name === "head") done = true;
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.write(html);
  parser.end();

  const first = (...keys: string[]) => keys.map((k) => meta.get(k)).find((v) => v?.trim());
  return {
    title: clean(first("og:title", "twitter:title"), MAX_TITLE),
    documentTitle: clean(title, MAX_TITLE),
    siteName: clean(first("og:site_name", "application-name"), MAX_SITE_NAME),
    image: absolute(first("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"), base),
    oembed: absolute(oembed, base),
  };
}

/** The fields we use from an oEmbed response. Its `html` is never used: we don't embed third-party markup. */
export function parseOembed(json: unknown, base: URL): OembedMeta {
  const data = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof data[key] === "string" ? (data[key] as string) : null);
  return {
    title: clean(text("title"), MAX_TITLE),
    siteName: clean(text("provider_name"), MAX_SITE_NAME),
    image: absolute(text("thumbnail_url"), base),
  };
}
