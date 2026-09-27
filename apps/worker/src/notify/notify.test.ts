import { randomUUID } from "node:crypto";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, schema } from "@kasa/db";
import { createTestDatabase, type TestDatabase } from "@kasa/db/testing";
import { notifyKey, startQueue, type JobQueue, type SendOptions } from "@kasa/jobs";
import { verifyUnsubscribeToken } from "@kasa/shared/unsubscribe";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sendNotifications } from "./index";
import { mailerFromEnv, resendMailer, type Email, type Mailer } from "./mailer";
import { renderEmail, snippet, subjectFor, type EmailItem } from "./render";

const reply = (authorName: string | null, body: string | null, originalBody = "Ryokan with a private onsen"): EmailItem => ({
  kind: "reply",
  authorName,
  entry: { kind: authorName ? "note" : "bot", body },
  original: { kind: "note", body: originalBody },
});
const mention = (authorName: string, body: string): EmailItem => ({ kind: "mention", authorName, entry: { kind: "note", body }, original: null });
const input = (items: EmailItem[]) => ({
  projectName: "Japan 2027",
  projectUrl: "https://kasa.test/projects/p1",
  unsubscribeUrl: "https://kasa.test/unsubscribe?token=t",
  items,
});

describe("email wording (D-167)", () => {
  it("subjects", () => {
    expect(subjectFor("Japan 2027", [reply("Mika Tanaka", "Yes!")])).toBe("Mika replied to you in Japan 2027");
    expect(subjectFor("Japan 2027", [mention("Mika", "@Petr hi")])).toBe("Mika mentioned you in Japan 2027");
    expect(subjectFor("Japan 2027", [reply("Mika", "a"), reply("Aiko", "b"), reply(null, "c")])).toBe("3 replies in Japan 2027");
    expect(subjectFor("Japan 2027", [mention("Mika", "a"), mention("Aiko", "b")])).toBe("2 mentions in Japan 2027");
    expect(subjectFor("Japan 2027", [reply("Mika", "a"), mention("Aiko", "b"), reply(null, "c"), mention("Mika", "d")])).toBe(
      "4 replies and mentions in Japan 2027",
    );
  });

  it("snippets are cut at 140 characters, and text-less entries say what they are", () => {
    expect(snippet({ kind: "note", body: "  Yes!\n Let's   book it. " })).toBe("Yes! Let's book it.");
    expect(snippet({ kind: "photo", body: null })).toBe("(a photo)");
    expect(snippet({ kind: "link", body: "" })).toBe("(a link)");
    const long = snippet({ kind: "note", body: "a".repeat(200) });
    expect(long).toHaveLength(140);
    expect(long.endsWith("…")).toBe(true);
  });

  it("one reply: heading, the original as a greyed line, the reply, the button, and the footer", () => {
    const email = renderEmail(input([reply("Mika Tanaka", "Yes! Let's book it.")]));
    expect(email.text).toBe(
      [
        "Mika replied to your note",
        "",
        "> Ryokan with a private onsen",
        "Yes! Let's book it.",
        "",
        "Open Japan 2027: https://kasa.test/projects/p1",
        "",
        "You're getting this because you're in Japan 2027 on Kasa. Mute emails from this pile: https://kasa.test/unsubscribe?token=t",
      ].join("\n"),
    );
    expect(email.html).toContain("Mika replied to your note");
    expect(email.html).toContain(">Open Japan 2027</a>");
    expect(email.html).toContain(">Mute emails from this pile</a>");
  });

  it("one mention", () => {
    const email = renderEmail(input([mention("Mika", "@Petr should we book the ryokan before the flights?")]));
    expect(email.text.split("\n").slice(0, 3)).toEqual(["Mika mentioned you", "", "@Petr should we book the ryokan before the flights?"]);
  });

  it("batched: one line each, at most 5, then '…and N more'", () => {
    const items = [
      { ...reply("Mika", "Yes! Let's book it."), original: { kind: "link" as const, body: null } },
      mention("Aiko", "@Petr can you check the JR Pass?"),
      { ...reply(null, "That's Kinkaku-ji; mornings are quietest."), original: { kind: "photo" as const, body: null } },
      mention("Aiko", "4"),
      mention("Aiko", "5"),
      mention("Aiko", "6"),
    ];
    const email = renderEmail(input(items));
    expect(email.text.split("\n").slice(0, 9)).toEqual([
      "6 new for you in Japan 2027",
      "",
      "Mika replied to your link: Yes! Let's book it.",
      "Aiko mentioned you: @Petr can you check the JR Pass?",
      "Kasa Bot replied to your photo: That's Kinkaku-ji; mornings are quietest.",
      "Aiko mentioned you: 4",
      "Aiko mentioned you: 5",
      "…and 1 more",
      "",
    ]);
    expect(email.html).toContain("<strong>Kasa Bot</strong> replied to your photo");
  });

  it("escapes names and text in HTML", () => {
    const email = renderEmail({ ...input([mention("<b>Mallory</b>", `<img src=x onerror=alert(1)> & "quotes"`)]), projectName: "<script>" });
    expect(email.html).not.toMatch(/<img|<script>|<b>Mallory/);
    expect(email.html).toContain("&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quotes&quot;");
  });
});

describe("mailers", () => {
  it("posts to Resend with the key, an idempotency key, and the unsubscribe headers", async () => {
    const received: { headers: IncomingHttpHeaders; body: Record<string, unknown>; url?: string }[] = [];
    let status = 200;
    const server = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        received.push({ headers: req.headers, body: JSON.parse(data) as Record<string, unknown>, url: req.url });
        res.writeHead(status, { "content-type": "application/json" }).end('{"id":"e1"}');
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const mailer = resendMailer({ apiKey: "re_test", from: "Kasa <n@kasa.test>", baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
      const email: Email = { to: "petr@example.com", subject: "S", html: "<p>H</p>", text: "T", headers: { "List-Unsubscribe": "<u>" }, idempotencyKey: "k1" };
      await mailer.send(email);
      expect(received[0]).toMatchObject({
        url: "/emails",
        headers: { authorization: "Bearer re_test", "idempotency-key": "k1" },
        body: { from: "Kasa <n@kasa.test>", to: ["petr@example.com"], subject: "S", html: "<p>H</p>", text: "T", headers: { "List-Unsubscribe": "<u>" } },
      });
      status = 500;
      await expect(mailer.send(email)).rejects.toThrow("Resend responded 500");
    } finally {
      server.close();
    }
  });

  it("logs instead of sending without a key; needs a sender and a secret with one", () => {
    expect(mailerFromEnv({}).kind).toBe("log");
    expect(() => mailerFromEnv({ RESEND_API_KEY: "re_x", UNSUBSCRIBE_SECRET: "s" })).toThrow(/EMAIL_FROM/);
    expect(() => mailerFromEnv({ RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.c" })).toThrow(/UNSUBSCRIBE_SECRET/);
    expect(mailerFromEnv({ RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.c", UNSUBSCRIBE_SECRET: "s" }).kind).toBe("resend");
  });
});

describe.skipIf(!process.env.DATABASE_URL)("notify.send", () => {
  let testDb: TestDatabase;
  const db = () => testDb.db;
  const u = { petr: randomUUID(), mika: randomUUID() };
  const projectId = randomUUID();
  const sent: Email[] = [];
  const queued: { payload: unknown; options?: SendOptions }[] = [];
  const mailer: Mailer = { kind: "log", send: async (e) => void sent.push(e) };
  const queue: JobQueue = { send: async (_name, payload, options) => void queued.push({ payload, options }) };
  let clock = new Date("2026-09-27T12:00:00Z");
  const deps = () => ({ db: db(), queue, mailer, appUrl: "https://kasa.test/", unsubscribeSecret: "s3cret", now: () => clock });

  beforeAll(async () => {
    testDb = await createTestDatabase(process.env.DATABASE_URL!);
    await db()
      .insert(schema.users)
      .values([
        { id: u.petr, name: "Petr", email: `petr-${u.petr}@example.com` },
        { id: u.mika, name: "Mika Tanaka", email: `mika-${u.mika}@example.com` },
      ]);
    await db().insert(schema.projects).values({ id: projectId, name: "Japan 2027", ownerId: u.petr });
    await db()
      .insert(schema.memberships)
      .values([
        { projectId, userId: u.petr, role: "owner" },
        { projectId, userId: u.mika, role: "editor" },
      ]);
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    sent.length = 0;
    queued.length = 0;
    clock = new Date(clock.getTime() + 60 * 60_000);
    await db()
      .update(schema.memberships)
      .set({ emailsMuted: false, lastEmailedAt: null, lastReadAt: null })
      .where(eq(schema.memberships.userId, u.petr));
  });

  /** Petr's note, and Mika's reply to it, notified to Petr. */
  async function replyToPetr(body = "Yes! Let's book it.") {
    const [original] = await db().insert(schema.entries).values({ projectId, authorId: u.petr, kind: "note", body: "Ryokan with a private onsen" }).returning();
    const [answer] = await db()
      .insert(schema.entries)
      .values({ projectId, authorId: u.mika, kind: "note", body, replyToId: original!.id, createdAt: new Date(clock.getTime() - 1000) })
      .returning();
    const [n] = await db().insert(schema.notifications).values({ userId: u.petr, projectId, entryId: answer!.id, kind: "reply" }).returning();
    return { answer: answer!, notification: n! };
  }
  const pending = async () =>
    db()
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, u.petr), eq(schema.notifications.projectId, projectId)))
      .then((rows) => rows.filter((r) => !r.handledAt));
  const lastEmailedAt = async () =>
    (await db().select().from(schema.memberships).where(and(eq(schema.memberships.userId, u.petr), eq(schema.memberships.projectId, projectId))))[0]!.lastEmailedAt;

  it("emails a reply with one-click unsubscribe headers, then marks it handled", async () => {
    await replyToPetr();
    await sendNotifications(deps(), u.petr, projectId);

    expect(sent).toHaveLength(1);
    const [email] = sent as [Email];
    expect(email.to).toBe(`petr-${u.petr}@example.com`);
    expect(email.subject).toBe("Mika replied to you in Japan 2027");
    expect(email.text).toContain("> Ryokan with a private onsen");
    expect(email.text).toContain(`Open Japan 2027: https://kasa.test/projects/${projectId}`);
    const token = new URL(/<(.*)>/.exec(email.headers["List-Unsubscribe"]!)![1]!).searchParams.get("token");
    expect(verifyUnsubscribeToken("s3cret", token)).toEqual({ userId: u.petr, projectId });
    expect(email.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(email.text).toContain(`https://kasa.test/unsubscribe?token=${encodeURIComponent(token!)}`);
    expect(await pending()).toEqual([]);
    expect(await lastEmailedAt()).toEqual(clock);
  });

  it("sends at most one email per 15 minutes; the rest wait and go out together", async () => {
    await replyToPetr("first");
    await sendNotifications(deps(), u.petr, projectId);
    expect(sent).toHaveLength(1);

    await replyToPetr("second");
    await replyToPetr("third");
    clock = new Date(clock.getTime() + 5 * 60_000);
    await sendNotifications(deps(), u.petr, projectId);
    expect(sent).toHaveLength(1);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.options).toEqual({ startAfter: new Date(clock.getTime() + 10 * 60_000), singletonKey: `${u.petr}:${projectId}` });
    expect(await pending()).toHaveLength(2);

    clock = new Date(clock.getTime() + 10 * 60_000);
    await sendNotifications(deps(), u.petr, projectId);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.subject).toBe("2 replies in Japan 2027");
    expect(await pending()).toEqual([]);
  });

  it("the same batch always has the same idempotency key", async () => {
    await replyToPetr();
    const flaky: Mailer = {
      kind: "log",
      send: async (e) => {
        sent.push(e);
        if (sent.length === 1) throw new Error("network");
      },
    };
    await expect(sendNotifications({ ...deps(), mailer: flaky }, u.petr, projectId)).rejects.toThrow("network");
    expect(await pending()).toHaveLength(1); // rolled back, so the retry sends it
    await sendNotifications({ ...deps(), mailer: flaky }, u.petr, projectId);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.idempotencyKey).toBe(sent[0]!.idempotencyKey);
  });

  it("skips entries deleted since, and entries already seen in the app", async () => {
    const deleted = await replyToPetr("gone");
    await db().update(schema.entries).set({ deletedAt: clock }).where(eq(schema.entries.id, deleted.answer.id));
    await replyToPetr("seen");
    await db().update(schema.memberships).set({ lastReadAt: clock }).where(eq(schema.memberships.userId, u.petr));
    await sendNotifications(deps(), u.petr, projectId);
    expect(sent).toEqual([]);
    expect(await pending()).toEqual([]);
    expect(await lastEmailedAt()).toBeNull();
  });

  it("sends nothing while muted, or after the person left", async () => {
    await replyToPetr();
    await db().update(schema.memberships).set({ emailsMuted: true }).where(eq(schema.memberships.userId, u.petr));
    await sendNotifications(deps(), u.petr, projectId);
    expect(sent).toEqual([]);
    expect(await pending()).toEqual([]);

    const outsider = randomUUID();
    await db().insert(schema.users).values({ id: outsider, name: "Ex", email: `ex-${outsider}@example.com` });
    await sendNotifications(deps(), outsider, projectId);
    expect(sent).toEqual([]);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("notify.send queue", () => {
  it("keeps at most one waiting and one running job per person and project", async () => {
    const testDb = await createTestDatabase(process.env.DATABASE_URL!);
    const { boss, queue } = await startQueue(testDb.url, "worker");
    try {
      const payload = { userId: randomUUID(), projectId: randomUUID() };
      const key = notifyKey(payload.userId, payload.projectId);
      await queue.send("notify.send", payload, { singletonKey: key });
      await queue.send("notify.send", payload, { singletonKey: key }); // no-op: one is already waiting
      const first = await boss.fetch("notify.send", { batchSize: 10 });
      expect(first).toHaveLength(1);

      // While that one runs, one more may wait.
      await queue.send("notify.send", payload, { singletonKey: key });
      await queue.send("notify.send", payload, { singletonKey: key });
      expect(await boss.fetch("notify.send", { batchSize: 10 })).toEqual([]); // the running one holds the next back
      await boss.complete("notify.send", first[0]!.id);
      expect(await boss.fetch("notify.send", { batchSize: 10 })).toHaveLength(1);
    } finally {
      await boss.stop({ graceful: false });
      await testDb.drop();
    }
  });
});
