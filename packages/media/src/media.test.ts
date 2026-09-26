import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { checkUpload, MAX_UPLOAD_BYTES } from "./limits";
import { processImage, THUMB_WIDTH, UnsupportedImageError } from "./process";
import { createStorage, storageConfigFromEnv } from "./storage";

const photo = (width = 1600, height = 900) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 60 } } });

describe("checkUpload", () => {
  it("accepts supported images within the size limit", () => {
    expect(checkUpload({ contentType: "image/png", size: 1024 })).toEqual({ ok: true, contentType: "image/png", size: 1024 });
  });

  it.each([
    ["image/svg+xml", 10],
    ["image/heic", 10],
    ["application/pdf", 10],
    [42, 10],
  ])("rejects type %s", (contentType, size) => {
    expect(checkUpload({ contentType, size })).toEqual({ ok: false, reason: "type" });
  });

  it.each([0, -1, 1.5, MAX_UPLOAD_BYTES + 1, "100"])("rejects size %s", (size) => {
    expect(checkUpload({ contentType: "image/jpeg", size })).toEqual({ ok: false, reason: "size" });
  });
});

describe("processImage", () => {
  it("strips EXIF, including GPS location", async () => {
    const input = await photo()
      .withExif({
        IFD0: { Make: "PhoneCo", Model: "Snap 9" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "60/1 10/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "24/1 56/1 0/1" },
      })
      .jpeg()
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const out = await processImage(input, "image/jpeg");
    for (const body of [out.full.body, out.thumb.body]) {
      const meta = await sharp(body).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(body.includes(Buffer.from("PhoneCo"))).toBe(false);
    }
  });

  it("applies EXIF orientation before stripping it", async () => {
    // Orientation 6 means "rotate 90° clockwise to display".
    const input = await photo(400, 200).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const out = await processImage(input, "image/jpeg");
    expect([out.full.width, out.full.height]).toEqual([200, 400]);
  });

  it("makes a WebP thumbnail no wider than the limit", async () => {
    const out = await processImage(await photo(2000, 1000).png().toBuffer(), "image/png");
    expect(out.full).toMatchObject({ contentType: "image/png", width: 2000, height: 1000 });
    expect(out.thumb).toMatchObject({ contentType: "image/webp", width: THUMB_WIDTH, height: 320 });
    expect((await sharp(out.thumb.body).metadata()).format).toBe("webp");
  });

  it("doesn't enlarge small images", async () => {
    const out = await processImage(await photo(300, 200).webp().toBuffer(), "image/webp");
    expect(out.thumb.width).toBe(300);
  });

  it("rejects bytes that aren't an image", async () => {
    await expect(processImage(Buffer.from("<svg onload=alert(1)>"), "image/png")).rejects.toThrow(UnsupportedImageError);
  });

  it("rejects a file whose content doesn't match the declared type", async () => {
    const png = await photo(10, 10).png().toBuffer();
    await expect(processImage(png, "image/jpeg")).rejects.toThrow(UnsupportedImageError);
  });
});

const hasStorage = Boolean(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID);

describe.skipIf(!hasStorage)("storage (local S3)", () => {
  const storage = createStorage(storageConfigFromEnv());
  const key = `test/${randomUUID()}`;
  const body = Buffer.from("x".repeat(100));

  it("accepts a PUT that matches the signed type and size", async () => {
    const url = await storage.presignUpload(key, "image/png", body.length);
    const res = await fetch(url, { method: "PUT", body, headers: { "content-type": "image/png" } });
    expect(res.status).toBe(200);
    expect(await storage.head(key)).toMatchObject({ size: 100, contentType: "image/png" });
    await storage.remove(key);
    expect(await storage.head(key)).toBeNull();
  });

  it("rejects a PUT with a different content type", async () => {
    const url = await storage.presignUpload(`${key}-type`, "image/png", body.length);
    const res = await fetch(url, { method: "PUT", body, headers: { "content-type": "text/html" } });
    expect(res.ok).toBe(false);
  });

  it("rejects a PUT with a different size", async () => {
    const url = await storage.presignUpload(`${key}-size`, "image/png", body.length);
    const res = await fetch(url, { method: "PUT", body: Buffer.concat([body, body]), headers: { "content-type": "image/png" } });
    expect(res.ok).toBe(false);
    expect(await storage.head(`${key}-size`)).toBeNull();
  });
});
