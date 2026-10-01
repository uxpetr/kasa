import { and, eq, isNull, schema, sql, type Database } from "@kasa/db";
import { keys, type Storage } from "@kasa/media";
import { processPreview, UnsupportedImageError } from "@kasa/media/process";
import type { Logger } from "@kasa/observability";
import type { AddressPolicy } from "./address";
import { parseOembed, parsePage, type OembedMeta } from "./parse";
import { safeFetch, UnfurlRefusedError } from "./safe-fetch";

export interface UnfurlDeps {
  db: Database;
  storage: Storage;
  log?: Logger;
  policy?: AddressPolicy;
  timeoutMs?: number;
}

export const MAX_HTML_BYTES = 1024 * 1024;
export const MAX_OEMBED_BYTES = 256 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Smaller images are tracking pixels or icons, not previews. */
const MIN_IMAGE_SIDE = 64;

function decode(body: Buffer, charset: string | undefined): string {
  try {
    return new TextDecoder(charset ?? "utf-8").decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

export interface Preview {
  title: string | null;
  siteName: string | null;
  /** Where the re-hosted image was stored, or null when there's none. */
  imageKey: string | null;
  host: string;
}

/**
 * Reads a page's Open Graph, Twitter, and oEmbed metadata server-side and re-hosts its preview
 * image at `imageKey`, so browsers never load the original page. Throws UnfurlRefusedError for
 * pages we won't or can't read, and network or server errors as they are.
 */
export async function fetchPreview(
  deps: Pick<UnfurlDeps, "storage" | "log" | "policy" | "timeoutMs">,
  url: string,
  imageKey: string,
  attrs: Record<string, string> = {},
): Promise<Preview> {
  const fetchOptions = { policy: deps.policy, timeoutMs: deps.timeoutMs };
  const page = await safeFetch(url, {
    ...fetchOptions,
    accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
    contentTypes: (t) => t === "text/html" || t === "application/xhtml+xml",
    maxBytes: MAX_HTML_BYTES,
    truncate: true,
  });

  const meta = parsePage(decode(page.body, page.charset), page.url);
  let oembed: OembedMeta = { title: null, siteName: null, image: null };
  if (meta.oembed) {
    try {
      const response = await safeFetch(meta.oembed, {
        ...fetchOptions,
        accept: "application/json",
        contentTypes: (t) => t === "application/json" || t === "text/javascript" || t === "application/json+oembed",
        maxBytes: MAX_OEMBED_BYTES,
      });
      oembed = parseOembed(JSON.parse(response.body.toString("utf8")), response.url);
    } catch (error) {
      deps.log?.info("oembed skipped", { ...attrs, reason: error instanceof Error ? error.message : "unknown" });
    }
  }

  const title = meta.title ?? oembed.title ?? meta.documentTitle;
  const siteName = meta.siteName ?? oembed.siteName;
  const imageUrl = meta.image ?? oembed.image;

  let stored: string | null = null;
  if (imageUrl) {
    try {
      const image = await safeFetch(imageUrl, {
        ...fetchOptions,
        accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9",
        contentTypes: (t) => t.startsWith("image/") && t !== "image/svg+xml",
        maxBytes: MAX_IMAGE_BYTES,
      });
      const preview = await processPreview(image.body);
      if (preview.width >= MIN_IMAGE_SIDE && preview.height >= MIN_IMAGE_SIDE) {
        stored = imageKey;
        await deps.storage.write(imageKey, preview.body, preview.contentType);
      }
    } catch (error) {
      if (!(error instanceof UnfurlRefusedError || error instanceof UnsupportedImageError)) throw error;
      deps.log?.info("preview image skipped", { ...attrs, reason: error.message });
    }
  }
  return { title, siteName, imageKey: stored, host: page.url.hostname };
}

/**
 * link.unfurl (P-05): fills in a link entry's preview with fetchPreview.
 * Pages we won't or can't read keep the plain link; network and server errors throw so pg-boss retries.
 */
export async function unfurlEntry(deps: UnfurlDeps, entryId: string): Promise<void> {
  const [row] = await deps.db
    .select({ id: schema.linkPreviews.id, url: schema.linkPreviews.url, projectId: schema.entries.projectId })
    .from(schema.linkPreviews)
    .innerJoin(schema.entries, eq(schema.entries.id, schema.linkPreviews.entryId))
    .where(and(eq(schema.linkPreviews.entryId, entryId), isNull(schema.entries.deletedAt)));
  if (!row) return;

  const attrs = { "entry.id": entryId, "project.id": row.projectId };
  let preview: Preview;
  try {
    preview = await fetchPreview(deps, row.url, keys.preview(row.projectId, entryId), attrs);
  } catch (error) {
    if (error instanceof UnfurlRefusedError) return deps.log?.info("link not unfurled", { ...attrs, reason: error.message });
    throw error;
  }
  const { title, siteName, imageKey } = preview;

  await deps.db.transaction(async (tx) => {
    await tx.update(schema.linkPreviews).set({ title, siteName, imageKey }).where(eq(schema.linkPreviews.id, row.id));
    // Touching the entry notifies live clients (D-157).
    await tx.update(schema.entries).set({ updatedAt: sql`now()` }).where(eq(schema.entries.id, entryId));
  });
  deps.log?.info("link unfurled", { ...attrs, host: preview.host, has_title: Boolean(title), has_image: Boolean(imageKey) });
}
