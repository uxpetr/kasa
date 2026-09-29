// Uploads the demo's images to the bucket so the seeded feed renders with pictures (F-11).
import { readFile } from "node:fs/promises";
import { createStorage, storageConfigFromEnv, type Storage } from "@kasa/media";
import { SEED_IMAGES, seedKey } from "./seed-images";

export const SEED_IMAGE_DIR = new URL("../../../design/prototype/img/", import.meta.url);

export function seedImagePath(file: string): URL {
  return new URL(file, SEED_IMAGE_DIR);
}

/** Writes every seed image under `seed/`, overwriting earlier copies. Returns a line for the log. */
export async function uploadSeedImages(storage?: Storage): Promise<string> {
  if (!storage) {
    try {
      storage = createStorage(storageConfigFromEnv());
    } catch (error) {
      return `seed images skipped: ${(error as Error).message}`;
    }
  }
  for (const file of SEED_IMAGES) {
    await storage.write(seedKey(file), await readFile(seedImagePath(file)), "image/jpeg");
  }
  return `uploaded ${SEED_IMAGES.length} seed images`;
}
