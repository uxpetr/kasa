// Object keys. Everything for a project sits under projects/<id>/ so purges (V-09) can delete by prefix.
import { IMAGE_TYPES, type ImageType } from "./limits";

export const keys = {
  /** Where the client uploads. Deleted after processing; it may still carry EXIF location. */
  raw: (projectId: string, uploadId: string) => `projects/${projectId}/raw/${uploadId}`,
  full: (projectId: string, uploadId: string, type: ImageType) =>
    `projects/${projectId}/media/${uploadId}/full.${IMAGE_TYPES[type]}`,
  thumb: (projectId: string, uploadId: string) => `projects/${projectId}/media/${uploadId}/thumb.webp`,
  /** A link preview image, re-hosted from the linked site (P-05). */
  preview: (projectId: string, entryId: string) => `projects/${projectId}/previews/${entryId}.webp`,
};
