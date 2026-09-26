import { and, eq, schema, type Database } from "@kasa/db";
import { isImageType, keys, type Storage } from "@kasa/media";
import { processImage, UnsupportedImageError } from "@kasa/media/process";

export interface MediaDeps {
  db: Database;
  storage: Storage;
}

/**
 * media.process: strip metadata, make a thumbnail, delete the raw upload (F-06).
 * Bad files are marked failed and not retried; infrastructure errors throw so pg-boss retries.
 */
export async function processUpload(deps: MediaDeps, uploadId: string): Promise<void> {
  const [upload] = await deps.db.select().from(schema.uploads).where(eq(schema.uploads.id, uploadId));
  if (!upload || upload.status !== "processing") return;

  const rawKey = keys.raw(upload.projectId, upload.id);
  const markFailed = async (reason: string) => {
    await deps.db
      .update(schema.uploads)
      .set({ status: "failed", failureReason: reason })
      .where(eq(schema.uploads.id, upload.id));
    await deps.storage.remove(rawKey);
  };

  if (!isImageType(upload.contentType)) return markFailed("unsupported_type");

  const raw = await deps.storage.read(rawKey);
  let processed;
  try {
    processed = await processImage(raw, upload.contentType);
  } catch (error) {
    if (error instanceof UnsupportedImageError) return markFailed("not_an_image");
    throw error;
  }

  const fullKey = keys.full(upload.projectId, upload.id, upload.contentType);
  const thumbKey = keys.thumb(upload.projectId, upload.id);
  await deps.storage.write(fullKey, processed.full.body, processed.full.contentType);
  await deps.storage.write(thumbKey, processed.thumb.body, processed.thumb.contentType);
  await deps.db
    .update(schema.uploads)
    .set({ status: "ready", fullKey, thumbKey, width: processed.full.width, height: processed.full.height })
    .where(and(eq(schema.uploads.id, upload.id), eq(schema.uploads.status, "processing")));
  // Only the stripped copies are kept; the raw file may carry GPS location.
  await deps.storage.remove(rawKey);
}
