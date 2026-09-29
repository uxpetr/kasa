// Its own module so the seed script and the upload can share it without importing each other.

/** Images the demo refers to, as files in design/prototype/img/ stored under `seed/<file>` (F-11). */
export const SEED_IMAGES = ["kinkakuji.jpg", "kiyomizu.jpg", "osaka-castle.jpg", "tokyo-fuji.jpg", "higashiyama.jpg"] as const;
export type SeedImage = (typeof SEED_IMAGES)[number];

export const seedKey = (file: SeedImage) => `seed/${file}`;
