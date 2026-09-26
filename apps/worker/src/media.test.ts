import { randomUUID } from "node:crypto";
import { eq, schema } from "@kasa/db";
import { createTestDatabase, type TestDatabase } from "@kasa/db/testing";
import { startQueue, type JobPayloads } from "@kasa/jobs";
import { createStorage, keys, storageConfigFromEnv, type Storage } from "@kasa/media";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processUpload } from "./media";

const ready = Boolean(process.env.DATABASE_URL && process.env.S3_BUCKET);

describe.skipIf(!ready)("media.process", () => {
  let testDb: TestDatabase;
  let storage: Storage;
  const userId = randomUUID();
  const projectId = randomUUID();

  beforeAll(async () => {
    testDb = await createTestDatabase(process.env.DATABASE_URL!);
    storage = createStorage(storageConfigFromEnv());
    await testDb.db.insert(schema.users).values({ id: userId, name: "Aiko", email: `aiko-${userId}@example.com` });
    await testDb.db.insert(schema.projects).values({ id: projectId, name: "Trip", ownerId: userId });
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  const geotaggedJpeg = () =>
    sharp({ create: { width: 1200, height: 800, channels: 3, background: "#b3372a" } })
      .withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "35/1 0/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "135/1 46/1 0/1" } })
      .jpeg()
      .toBuffer();

  /** An upload the web app has marked complete, with its raw file in storage. */
  async function stagedUpload(body: Buffer, contentType: string) {
    const [upload] = await testDb.db
      .insert(schema.uploads)
      .values({ projectId, uploaderId: userId, contentType, size: body.length, status: "processing" })
      .returning();
    await storage.write(keys.raw(projectId, upload!.id), body, contentType);
    return upload!;
  }

  const row = async (id: string) => (await testDb.db.select().from(schema.uploads).where(eq(schema.uploads.id, id)))[0]!;

  it("stores stripped full and thumbnail images, then deletes the raw upload", async () => {
    const upload = await stagedUpload(await geotaggedJpeg(), "image/jpeg");
    await processUpload({ db: testDb.db, storage }, upload.id);

    const done = await row(upload.id);
    expect(done).toMatchObject({ status: "ready", width: 1200, height: 800 });
    expect(await storage.head(keys.raw(projectId, upload.id))).toBeNull();

    const full = await storage.read(done.fullKey!);
    expect((await sharp(full).metadata()).exif).toBeUndefined();
    const thumb = await sharp(await storage.read(done.thumbKey!)).metadata();
    expect(thumb).toMatchObject({ format: "webp", width: 640 });
  });

  it("marks non-images failed and deletes them", async () => {
    const upload = await stagedUpload(Buffer.from("<html>not a picture</html>"), "image/png");
    await processUpload({ db: testDb.db, storage }, upload.id);
    expect(await row(upload.id)).toMatchObject({ status: "failed", failureReason: "not_an_image", fullKey: null });
    expect(await storage.head(keys.raw(projectId, upload.id))).toBeNull();
  });

  it("ignores uploads that aren't waiting for processing", async () => {
    const upload = await stagedUpload(await geotaggedJpeg(), "image/jpeg");
    await testDb.db.update(schema.uploads).set({ status: "pending" }).where(eq(schema.uploads.id, upload.id));
    await processUpload({ db: testDb.db, storage }, upload.id);
    expect(await row(upload.id)).toMatchObject({ status: "pending" });
    expect(await storage.head(keys.raw(projectId, upload.id))).not.toBeNull();
  });

  it("runs through the real queue", async () => {
    const { boss, queue } = await startQueue(testDb.url, "worker");
    try {
      await boss.work<JobPayloads["media.process"]>("media.process", { pollingIntervalSeconds: 0.5 }, async ([job]) => {
        if (job) await processUpload({ db: testDb.db, storage }, job.data.uploadId);
      });
      const upload = await stagedUpload(await geotaggedJpeg(), "image/jpeg");
      await queue.send("media.process", { uploadId: upload.id });

      const deadline = Date.now() + 15_000;
      while ((await row(upload.id)).status !== "ready" && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }
      expect((await row(upload.id)).status).toBe("ready");
    } finally {
      await boss.stop({ graceful: false });
    }
  });
});
