// Upload flow (F-06, D-132): request a presigned PUT, upload straight to storage,
// then mark it complete so the worker processes it. Media is served through
// short-lived signed URLs to project members only.
import { and, eq, schema, type Database } from "@kasa/db";
import type { JobQueue } from "@kasa/jobs";
import { checkUpload, keys, type Storage } from "@kasa/media";
import { canAdd, canRead, projectRole } from "./access";

export interface UploadDeps {
  db: Database;
  storage: Storage;
  queue: JobQueue;
}

export type Result<T> = { ok: true; value: T } | { ok: false; status: 400 | 404 | 409 | 413 | 415; error: string };

const fail = <T>(status: 400 | 404 | 409 | 413 | 415, error: string): Result<T> => ({ ok: false, status, error });

export async function createUpload(
  deps: Pick<UploadDeps, "db" | "storage">,
  userId: string,
  input: { projectId?: unknown; contentType?: unknown; size?: unknown },
): Promise<Result<{ uploadId: string; uploadUrl: string; headers: Record<string, string> }>> {
  if (typeof input.projectId !== "string" || !isUuid(input.projectId)) return fail(400, "projectId is required");

  // Not a member and missing project look the same, so ids can't be probed.
  const role = await projectRole(deps.db, userId, input.projectId);
  if (!canAdd(role)) return fail(404, "Project not found");

  const check = checkUpload({ contentType: input.contentType, size: input.size });
  if (!check.ok) return check.reason === "type" ? fail(415, "Unsupported file type") : fail(413, "File too large");

  const [upload] = await deps.db
    .insert(schema.uploads)
    .values({ projectId: input.projectId, uploaderId: userId, contentType: check.contentType, size: check.size })
    .returning({ id: schema.uploads.id });
  if (!upload) throw new Error("insert failed");

  const uploadUrl = await deps.storage.presignUpload(
    keys.raw(input.projectId, upload.id),
    check.contentType,
    check.size,
  );
  return { ok: true, value: { uploadId: upload.id, uploadUrl, headers: { "content-type": check.contentType } } };
}

export async function completeUpload(
  deps: UploadDeps,
  userId: string,
  uploadId: string,
): Promise<Result<{ status: (typeof schema.uploadStatus.enumValues)[number] }>> {
  if (!isUuid(uploadId)) return fail(404, "Upload not found");
  const [upload] = await deps.db
    .select()
    .from(schema.uploads)
    .where(and(eq(schema.uploads.id, uploadId), eq(schema.uploads.uploaderId, userId)));
  if (!upload || !canAdd(await projectRole(deps.db, userId, upload.projectId))) return fail(404, "Upload not found");
  if (upload.status !== "pending") return { ok: true, value: { status: upload.status } };

  const stored = await deps.storage.head(keys.raw(upload.projectId, upload.id));
  if (!stored) return fail(409, "File hasn't been uploaded yet");
  if (stored.size !== upload.size || stored.contentType !== upload.contentType) {
    return fail(409, "Uploaded file doesn't match the request");
  }

  // Only one caller moves pending -> processing, so the job is enqueued once.
  const moved = await deps.db
    .update(schema.uploads)
    .set({ status: "processing" })
    .where(and(eq(schema.uploads.id, upload.id), eq(schema.uploads.status, "pending")))
    .returning({ id: schema.uploads.id });
  if (moved.length === 1) await deps.queue.send("media.process", { uploadId: upload.id });
  return { ok: true, value: { status: "processing" } };
}

export type MediaVariant = "full" | "thumb";

/** A short-lived URL for a processed image, or null when the user may not see it. */
export async function mediaUrl(
  deps: Pick<UploadDeps, "db" | "storage">,
  userId: string,
  uploadId: string,
  variant: MediaVariant,
): Promise<string | null> {
  if (!isUuid(uploadId)) return null;
  const [upload] = await deps.db.select().from(schema.uploads).where(eq(schema.uploads.id, uploadId));
  if (!upload || upload.status !== "ready") return null;
  if (!canRead(await projectRole(deps.db, userId, upload.projectId))) return null;
  const key = variant === "full" ? upload.fullKey : upload.thumbKey;
  return key ? deps.storage.presignDownload(key) : null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
