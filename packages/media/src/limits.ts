// Upload limits, enforced on the server (F-06, D-132).

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Image types we accept. HEIC is left out: the prebuilt sharp can't decode it. */
export const IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;
export type ImageType = keyof typeof IMAGE_TYPES;

export function isImageType(value: string): value is ImageType {
  return Object.hasOwn(IMAGE_TYPES, value);
}

export type UploadCheck = { ok: true; contentType: ImageType; size: number } | { ok: false; reason: "type" | "size" };

export function checkUpload(input: { contentType: unknown; size: unknown }): UploadCheck {
  if (typeof input.contentType !== "string" || !isImageType(input.contentType)) return { ok: false, reason: "type" };
  const size = input.size;
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: "size" };
  }
  return { ok: true, contentType: input.contentType, size };
}
