import sharp, { type FormatEnum, type Metadata } from "sharp";
import type { ImageType } from "./limits";

export const THUMB_WIDTH = 640;

export class UnsupportedImageError extends Error {}

export interface ProcessedImage {
  full: { body: Buffer; contentType: ImageType; width: number; height: number };
  thumb: { body: Buffer; contentType: "image/webp"; width: number; height: number };
}

const formatFor: Record<ImageType, "jpeg" | "png" | "webp" | "gif"> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Re-encodes an upload so no metadata survives (EXIF, including GPS location, XMP, IPTC),
 * applies the EXIF orientation first, and makes a thumbnail. Rejects bytes that aren't
 * the image type the client declared.
 */
export async function processImage(input: Buffer, declared: ImageType): Promise<ProcessedImage> {
  let meta: Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new UnsupportedImageError("Not a readable image");
  }
  if (meta.format !== formatFor[declared]) {
    throw new UnsupportedImageError(`Declared ${declared} but file is ${meta.format ?? "unknown"}`);
  }

  const animated = declared === "image/gif" || declared === "image/webp";
  // sharp drops all metadata unless asked to keep it; .rotate() bakes in the EXIF orientation.
  const base = () => sharp(input, { animated, limitInputPixels: 100_000_000 }).rotate();

  const full = await base()
    .toFormat(formatFor[declared] satisfies keyof FormatEnum, declared === "image/jpeg" ? { quality: 90, mozjpeg: true } : {})
    .toBuffer({ resolveWithObject: true });
  const thumb = await base()
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });

  return {
    full: { body: full.data, contentType: declared, width: full.info.width, height: full.info.pageHeight ?? full.info.height },
    thumb: { body: thumb.data, contentType: "image/webp", width: thumb.info.width, height: thumb.info.pageHeight ?? thumb.info.height },
  };
}

export const PREVIEW_WIDTH = 1200;
const PREVIEW_FORMATS = new Set(["jpeg", "png", "webp", "gif", "avif"]);

/**
 * Re-encodes a link preview image fetched from another site (P-05) as a metadata-free
 * WebP of at most PREVIEW_WIDTH. Only raster formats; SVG and anything else is refused.
 */
export async function processPreview(input: Buffer): Promise<{ body: Buffer; contentType: "image/webp"; width: number; height: number }> {
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: 50_000_000 }).metadata();
  } catch {
    throw new UnsupportedImageError("Not a readable image");
  }
  if (!meta.format || !PREVIEW_FORMATS.has(meta.format)) throw new UnsupportedImageError(`Unsupported format ${meta.format ?? "unknown"}`);
  const out = await sharp(input, { limitInputPixels: 50_000_000 })
    .rotate()
    .resize({ width: PREVIEW_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });
  return { body: out.data, contentType: "image/webp", width: out.info.width, height: out.info.height };
}
