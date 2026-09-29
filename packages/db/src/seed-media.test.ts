import { access } from "node:fs/promises";
import { createStorage, storageConfigFromEnv } from "@kasa/media";
import { describe, expect, it } from "vitest";
import { SEED_IMAGES } from "./seed-images";
import { seedImagePath, uploadSeedImages } from "./seed-media";

describe("seed images", () => {
  it("has a prototype file for every seed image", async () => {
    for (const file of SEED_IMAGES) await expect(access(seedImagePath(file))).resolves.toBeUndefined();
  });

  it("skips the upload when storage isn't configured", async () => {
    const saved = process.env.S3_BUCKET;
    delete process.env.S3_BUCKET;
    try {
      expect(await uploadSeedImages()).toMatch(/^seed images skipped: S3_BUCKET is not set/);
    } finally {
      if (saved !== undefined) process.env.S3_BUCKET = saved;
    }
  });

  // Needs the local bucket (`pnpm services`), as in CI.
  it.skipIf(!process.env.S3_ENDPOINT)("uploads every image under seed/", async () => {
    const storage = createStorage(storageConfigFromEnv());
    expect(await uploadSeedImages(storage)).toBe(`uploaded ${SEED_IMAGES.length} seed images`);
    for (const file of SEED_IMAGES) {
      const stored = await storage.head(`seed/${file}`);
      expect(stored?.contentType).toBe("image/jpeg");
      expect(stored?.size).toBeGreaterThan(0);
    }
  });
});
