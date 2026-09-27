import { randomUUID } from "node:crypto";
import { eq, schema } from "@kasa/db";
import { createTestDatabase, type TestDatabase } from "@kasa/db/testing";
import type { JobPayloads, JobQueue } from "@kasa/jobs";
import { createStorage, keys, MAX_UPLOAD_BYTES, storageConfigFromEnv, type Storage } from "@kasa/media";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { completeUpload, createUpload, mediaUrl } from "./uploads";

const ready = Boolean(process.env.DATABASE_URL && process.env.S3_BUCKET);

describe.skipIf(!ready)("uploads", () => {
  let testDb: TestDatabase;
  let storage: Storage;
  const sent: { name: string; payload: JobPayloads[keyof JobPayloads] }[] = [];
  const queue: JobQueue = {
    async send(name, payload) {
      sent.push({ name, payload });
    },
  };
  const u = { owner: randomUUID(), editor: randomUUID(), viewer: randomUUID(), outsider: randomUUID() };
  const projectId = randomUUID();
  const deletedProjectId = randomUUID();
  const png = Buffer.from("89504e470d0a1a0a", "hex"); // content isn't checked until the worker runs

  beforeAll(async () => {
    testDb = await createTestDatabase(process.env.DATABASE_URL!);
    storage = createStorage(storageConfigFromEnv());
    const db = testDb.db;
    await db.insert(schema.users).values(
      Object.entries(u).map(([name, id]) => ({ id, name, email: `${name}-${id}@example.com` })),
    );
    await db.insert(schema.projects).values([
      { id: projectId, name: "Trip", ownerId: u.owner },
      { id: deletedProjectId, name: "Gone", ownerId: u.owner, deletedAt: new Date() },
    ]);
    await db.insert(schema.memberships).values([
      { projectId, userId: u.owner, role: "owner" },
      { projectId, userId: u.editor, role: "editor" },
      { projectId, userId: u.viewer, role: "viewer" },
      { projectId: deletedProjectId, userId: u.owner, role: "owner" },
    ]);
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  const deps = () => ({ db: testDb.db, storage, queue });
  const request = { contentType: "image/png", size: png.length };

  async function uploadAs(userId: string) {
    const res = await createUpload(deps(), userId, { projectId, ...request });
    if (!res.ok) throw new Error(res.error);
    const put = await fetch(res.value.uploadUrl, { method: "PUT", body: png, headers: res.value.headers });
    expect(put.status).toBe(200);
    return res.value.uploadId;
  }

  describe("createUpload", () => {
    it("gives owners and editors a presigned URL for the raw key", async () => {
      for (const userId of [u.owner, u.editor]) {
        const res = await createUpload(deps(), userId, { projectId, ...request });
        expect(res.ok).toBe(true);
        if (res.ok) expect(res.value.uploadUrl).toContain(keys.raw(projectId, res.value.uploadId));
      }
    });

    it("refuses viewers and archived projects with 403", async () => {
      expect(await createUpload(deps(), u.viewer, { projectId, ...request })).toMatchObject({ ok: false, status: 403 });
      await testDb.db.update(schema.projects).set({ archivedAt: new Date() }).where(eq(schema.projects.id, projectId));
      try {
        expect(await createUpload(deps(), u.owner, { projectId, ...request })).toMatchObject({ ok: false, status: 403 });
      } finally {
        await testDb.db.update(schema.projects).set({ archivedAt: null }).where(eq(schema.projects.id, projectId));
      }
    });

    it("hides the project from outsiders and deleted projects", async () => {
      expect(await createUpload(deps(), u.outsider, { projectId, ...request })).toMatchObject({ ok: false, status: 404 });
      expect(await createUpload(deps(), u.owner, { projectId: deletedProjectId, ...request })).toMatchObject({
        ok: false,
        status: 404,
      });
      expect(await createUpload(deps(), u.owner, { projectId: randomUUID(), ...request })).toMatchObject({ status: 404 });
    });

    it("rejects unsupported types and oversized files", async () => {
      expect(await createUpload(deps(), u.owner, { projectId, contentType: "image/svg+xml", size: 10 })).toMatchObject({
        status: 415,
      });
      expect(
        await createUpload(deps(), u.owner, { projectId, contentType: "image/png", size: MAX_UPLOAD_BYTES + 1 }),
      ).toMatchObject({ status: 413 });
    });

    it("rejects a missing or malformed project id", async () => {
      expect(await createUpload(deps(), u.owner, request)).toMatchObject({ status: 400 });
      expect(await createUpload(deps(), u.owner, { projectId: "1 or 1=1", ...request })).toMatchObject({ status: 400 });
    });
  });

  describe("completeUpload", () => {
    it("refuses before the file is in storage", async () => {
      const res = await createUpload(deps(), u.owner, { projectId, ...request });
      if (!res.ok) throw new Error(res.error);
      expect(await completeUpload(deps(), u.owner, res.value.uploadId)).toMatchObject({ ok: false, status: 409 });
      expect(sent).toHaveLength(0);
    });

    it("queues processing exactly once", async () => {
      const uploadId = await uploadAs(u.owner);
      expect(await completeUpload(deps(), u.owner, uploadId)).toEqual({ ok: true, value: { status: "processing" } });
      expect(await completeUpload(deps(), u.owner, uploadId)).toEqual({ ok: true, value: { status: "processing" } });
      expect(sent).toEqual([{ name: "media.process", payload: { uploadId } }]);
    });

    it("puts the upload back to pending if the job cannot be queued", async () => {
      const uploadId = await uploadAs(u.owner);
      const broken: JobQueue = {
        async send() {
          throw new Error("queue down");
        },
      };
      expect(await completeUpload({ db: testDb.db, storage, queue: broken }, u.owner, uploadId)).toMatchObject({
        ok: false,
        status: 503,
      });
      const [row] = await testDb.db.select({ status: schema.uploads.status }).from(schema.uploads).where(eq(schema.uploads.id, uploadId));
      expect(row?.status).toBe("pending");
      expect(await completeUpload(deps(), u.owner, uploadId)).toEqual({ ok: true, value: { status: "processing" } });
      expect(sent).toEqual([{ name: "media.process", payload: { uploadId } }]);
    });

    it("only lets the uploader complete it", async () => {
      const uploadId = await uploadAs(u.editor);
      expect(await completeUpload(deps(), u.owner, uploadId)).toMatchObject({ ok: false, status: 404 });
      expect(sent).toHaveLength(0);
    });
  });

  describe("mediaUrl", () => {
    async function readyUpload() {
      const uploadId = await uploadAs(u.owner);
      const thumbKey = keys.thumb(projectId, uploadId);
      await storage.write(thumbKey, Buffer.from("thumb"), "image/webp");
      await testDb.db
        .update(schema.uploads)
        .set({ status: "ready", thumbKey, fullKey: keys.full(projectId, uploadId, "image/png") })
        .where(eq(schema.uploads.id, uploadId));
      return uploadId;
    }

    it("gives every member, viewers included, a working short-lived URL", async () => {
      const uploadId = await readyUpload();
      for (const userId of [u.owner, u.editor, u.viewer]) {
        const url = await mediaUrl(deps(), userId, uploadId, "thumb");
        expect(url).toMatch(/X-Amz-Expires=300/);
        const res = await fetch(url!);
        expect(await res.text()).toBe("thumb");
      }
    });

    it("gives outsiders nothing", async () => {
      const uploadId = await readyUpload();
      expect(await mediaUrl(deps(), u.outsider, uploadId, "thumb")).toBeNull();
    });

    it("serves nothing until processing is done", async () => {
      const uploadId = await uploadAs(u.owner);
      expect(await mediaUrl(deps(), u.owner, uploadId, "thumb")).toBeNull();
    });

    it("serves nothing once the project is deleted", async () => {
      const uploadId = await readyUpload();
      await testDb.db.update(schema.projects).set({ deletedAt: new Date() }).where(eq(schema.projects.id, projectId));
      try {
        expect(await mediaUrl(deps(), u.owner, uploadId, "thumb")).toBeNull();
      } finally {
        await testDb.db.update(schema.projects).set({ deletedAt: null }).where(eq(schema.projects.id, projectId));
      }
    });

    it("keeps the raw upload unreachable through the media route", async () => {
      const uploadId = await uploadAs(u.owner);
      await testDb.db.update(schema.uploads).set({ status: "ready" }).where(eq(schema.uploads.id, uploadId));
      expect(await mediaUrl(deps(), u.owner, uploadId, "full")).toBeNull();
    });
  });
});
