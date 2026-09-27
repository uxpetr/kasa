import { randomUUID } from "node:crypto";
import { and, eq, schema } from "@kasa/db";
import { createTestDatabase, type TestDatabase } from "@kasa/db/testing";
import { EMAIL_INTERVAL_MS, type JobPayloads, type JobQueue, type SendOptions } from "@kasa/jobs";
import { createUnsubscribeToken } from "@kasa/shared/unsubscribe";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createEntry } from "./entries";
import { parseMentions, setEmailsMuted, unsubscribe } from "./notifications";

describe("parseMentions", () => {
  it("accepts a list of user ids, deduplicated", () => {
    const id = randomUUID();
    expect(parseMentions(undefined)).toEqual({ ok: true, value: [] });
    expect(parseMentions([id, id])).toEqual({ ok: true, value: [id] });
    expect(parseMentions(["nope"]).ok).toBe(false);
    expect(parseMentions("x").ok).toBe(false);
    expect(parseMentions(Array.from({ length: 21 }, () => randomUUID())).ok).toBe(false);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("notifications", () => {
  let testDb: TestDatabase;
  const db = () => testDb.db;
  const u = { owner: randomUUID(), editor: randomUUID(), viewer: randomUUID(), muted: randomUUID(), outsider: randomUUID() };
  const projectId = randomUUID();
  const sent: { name: string; payload: JobPayloads[keyof JobPayloads]; options?: SendOptions }[] = [];
  const queue: JobQueue = { send: async (name, payload, options) => void sent.push({ name, payload, options }) };

  beforeAll(async () => {
    testDb = await createTestDatabase(process.env.DATABASE_URL!);
    await db().insert(schema.users).values(Object.entries(u).map(([name, id]) => ({ id, name: `${name} person`, email: `${name}-${id}@example.com` })));
    await db().insert(schema.projects).values({ id: projectId, name: "Japan 2027", ownerId: u.owner });
    await db()
      .insert(schema.memberships)
      .values([
        { projectId, userId: u.owner, role: "owner" },
        { projectId, userId: u.editor, role: "editor" },
        { projectId, userId: u.viewer, role: "viewer" },
        { projectId, userId: u.muted, role: "editor", emailsMuted: true },
      ]);
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  const notificationsFor = async (entryId: string) =>
    (await db().select().from(schema.notifications).where(eq(schema.notifications.entryId, entryId))).map((n) => ({ userId: n.userId, kind: n.kind })).sort((a, b) => a.userId.localeCompare(b.userId));
  const sortBy = <T extends { userId: string }>(rows: T[]) => rows.sort((a, b) => a.userId.localeCompare(b.userId));

  it("notifies picked members, and not the author, outsiders, or muted members", async () => {
    const res = await createEntry(db(), u.editor, projectId, { text: "@owner @viewer @editor look", mentions: [u.owner, u.viewer, u.editor, u.outsider, u.muted] }, queue);
    expect(res.ok).toBe(true);
    const id = res.ok ? res.value.id : "";
    expect(await notificationsFor(id)).toEqual(sortBy([{ userId: u.owner, kind: "mention" }, { userId: u.viewer, kind: "mention" }]));
    expect(sent.map((s) => s.payload)).toEqual(expect.arrayContaining([{ userId: u.owner, projectId }, { userId: u.viewer, projectId }]));
    expect(sent).toHaveLength(2);
    expect(sent[0]!.options?.singletonKey).toMatch(new RegExp(`^(${u.owner}|${u.viewer}):${projectId}$`));
  });

  it("notifies the author of the entry replied to, once, as a reply", async () => {
    const [original] = await db().insert(schema.entries).values({ projectId, authorId: u.owner, kind: "note", body: "Ryokan" }).returning();
    const res = await createEntry(db(), u.editor, projectId, { text: "Yes! @owner", replyToId: original!.id, mentions: [u.owner] }, queue);
    const id = res.ok ? res.value.id : "";
    expect(await notificationsFor(id)).toEqual([{ userId: u.owner, kind: "reply" }]);
    expect(sent).toHaveLength(1);

    // Replying to your own entry notifies no one.
    sent.length = 0;
    const own = await createEntry(db(), u.owner, projectId, { text: "and more", replyToId: original!.id }, queue);
    expect(await notificationsFor(own.ok ? own.value.id : "")).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("waits for the 15-minute window after the last email", async () => {
    const last = new Date(Date.now() - 5 * 60_000);
    await db()
      .update(schema.memberships)
      .set({ lastEmailedAt: last })
      .where(and(eq(schema.memberships.projectId, projectId), eq(schema.memberships.userId, u.owner)));
    await createEntry(db(), u.editor, projectId, { text: "@owner again", mentions: [u.owner] }, queue);
    expect(sent[0]!.options?.startAfter).toEqual(new Date(last.getTime() + EMAIL_INTERVAL_MS));
  });

  it("rejects malformed mentions and still saves entries without a queue", async () => {
    expect((await createEntry(db(), u.editor, projectId, { text: "hi", mentions: ["x"] }, queue)).ok).toBe(false);
    const res = await createEntry(db(), u.editor, projectId, { text: "@owner no queue", mentions: [u.owner] });
    expect(res.ok).toBe(true);
    expect(await notificationsFor(res.ok ? res.value.id : "")).toEqual([{ userId: u.owner, kind: "mention" }]);
  });

  it("queues links for unfurling", async () => {
    const res = await createEntry(db(), u.editor, projectId, { text: "https://example.com/ryokan" }, queue);
    expect(sent).toEqual([{ name: "link.unfurl", payload: { entryId: res.ok ? res.value.id : "" }, options: undefined }]);
  });

  it("mutes from the project menu: members only, their own membership only", async () => {
    expect(await setEmailsMuted(db(), u.viewer, projectId, true)).toEqual({ ok: true, value: { muted: true } });
    const rows = await db().select().from(schema.memberships).where(eq(schema.memberships.projectId, projectId));
    expect(rows.filter((r) => r.emailsMuted).map((r) => r.userId).sort()).toEqual([u.muted, u.viewer].sort());
    expect(await setEmailsMuted(db(), u.viewer, projectId, false)).toEqual({ ok: true, value: { muted: false } });
    expect((await setEmailsMuted(db(), u.outsider, projectId, true)).ok).toBe(false);
    expect(await setEmailsMuted(db(), u.viewer, projectId, "yes")).toMatchObject({ ok: false, status: 400 });
  });

  it("unsubscribes by signed link, without a sign-in", async () => {
    const token = createUnsubscribeToken("s3cret", { userId: u.editor, projectId });
    expect(await unsubscribe(db(), "s3cret", token, true)).toEqual({ ok: true, value: { projectId, projectName: "Japan 2027", muted: true } });
    const muted = async () =>
      (await db().select().from(schema.memberships).where(and(eq(schema.memberships.projectId, projectId), eq(schema.memberships.userId, u.editor))))[0]!.emailsMuted;
    expect(await muted()).toBe(true);
    await unsubscribe(db(), "s3cret", token, false);
    expect(await muted()).toBe(false);

    expect(await unsubscribe(db(), "other", token, true)).toMatchObject({ ok: false, status: 404 });
    expect(await unsubscribe(db(), undefined, token, true)).toMatchObject({ ok: false, status: 404 });
    expect(await unsubscribe(db(), "s3cret", "garbage", true)).toMatchObject({ ok: false, status: 404 });
  });
});
