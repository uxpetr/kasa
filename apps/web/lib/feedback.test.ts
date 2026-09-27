import { randomUUID } from "node:crypto";
import { eq, schema } from "@kasa/db";
import { createTestDatabase, type TestDatabase } from "@kasa/db/testing";
import type { JobPayloads, JobQueue } from "@kasa/jobs";
import { setAnalyticsSink, type TrackedEvent } from "@kasa/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isPilotAdmin, listFeedback, MAX_FEEDBACK_LENGTH, sendFeedback } from "./feedback";

describe("isPilotAdmin", () => {
  it("matches PILOT_ADMIN_EMAILS, ignoring case and spaces; empty means nobody", () => {
    const env = { PILOT_ADMIN_EMAILS: " petr@example.com , other@example.com" };
    expect(isPilotAdmin("Petr@Example.com", env)).toBe(true);
    expect(isPilotAdmin("mika@example.com", env)).toBe(false);
    expect(isPilotAdmin(undefined, env)).toBe(false);
    expect(isPilotAdmin("petr@example.com", {})).toBe(false);
    expect(isPilotAdmin("", { PILOT_ADMIN_EMAILS: "," })).toBe(false);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("feedback", () => {
  let testDb: TestDatabase;
  const db = () => testDb.db;
  const userId = randomUUID();
  const sent: { name: string; payload: JobPayloads[keyof JobPayloads] }[] = [];
  const queue: JobQueue = { send: async (name, payload) => void sent.push({ name, payload }) };
  const events: TrackedEvent[] = [];
  let restoreSink: () => void;

  beforeAll(async () => {
    testDb = await createTestDatabase(process.env.DATABASE_URL!);
    await db().insert(schema.users).values({ id: userId, name: "Mika Tanaka", email: `mika-${userId}@example.com` });
    restoreSink = setAnalyticsSink((e) => void events.push(e));
  });

  afterAll(async () => {
    restoreSink?.();
    await testDb?.drop();
  });

  beforeEach(() => {
    sent.length = 0;
    events.length = 0;
  });

  it("stores the message with its page, queues the email, and tracks no text", async () => {
    const res = await sendFeedback(db(), userId, { text: "  Love the polaroids.\nSearch?  ", page: "/projects/abc" }, queue);
    expect(res.ok).toBe(true);
    const id = res.ok ? res.value.id : "";
    const [row] = await db().select().from(schema.feedback).where(eq(schema.feedback.id, id));
    expect(row).toMatchObject({ userId, body: "Love the polaroids.\nSearch?", page: "/projects/abc", emailedAt: null });
    expect(sent).toEqual([{ name: "feedback.send", payload: { feedbackId: id } }]);
    expect(events).toEqual([expect.objectContaining({ event: "feedback_sent", userId, properties: {} })]);
  });

  it("refuses empty or too-long messages, and keeps only same-site paths", async () => {
    expect(await sendFeedback(db(), userId, { text: "   " }, queue)).toMatchObject({ ok: false, status: 400 });
    expect(await sendFeedback(db(), userId, null, queue)).toMatchObject({ ok: false, status: 400 });
    expect(await sendFeedback(db(), userId, { text: "a".repeat(MAX_FEEDBACK_LENGTH + 1) }, queue)).toMatchObject({ ok: false, status: 400 });
    expect(sent).toEqual([]);

    for (const page of ["https://evil.example/x", "//evil.example", 42, "/" + "a".repeat(400)]) {
      const res = await sendFeedback(db(), userId, { text: "hi", page });
      const [row] = await db().select().from(schema.feedback).where(eq(schema.feedback.id, res.ok ? res.value.id : ""));
      expect(row!.page).toBeNull();
    }
  });

  it("stores the message even when the queue is down", async () => {
    const broken: JobQueue = { send: async () => Promise.reject(new Error("down")) };
    expect((await sendFeedback(db(), userId, { text: "Still here?" }, broken)).ok).toBe(true);
  });

  it("lists newest first, with who sent it", async () => {
    const list = await listFeedback(db());
    expect(list[0]).toMatchObject({ body: "Still here?", author: { name: "Mika Tanaka", email: `mika-${userId}@example.com` } });
    expect(list.at(-1)).toMatchObject({ body: "Love the polaroids.\nSearch?", page: "/projects/abc" });
  });
});
