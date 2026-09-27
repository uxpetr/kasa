import { randomUUID } from "node:crypto";
import { eq, schema } from "@kasa/db";
import { createTestDatabase, type TestDatabase } from "@kasa/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailFeedback, renderFeedback } from "./feedback";
import type { Email, Mailer } from "./notify/mailer";

describe("renderFeedback", () => {
  it("quotes the message, who sent it, and where, escaping HTML", () => {
    const email = renderFeedback(
      { body: "Search <b>please</b>", page: "/projects/p1", author: { name: "Mika Tanaka", email: "mika@example.com" } },
      "https://kasa.test/feedback",
    );
    expect(email.subject).toBe("Kasa feedback from Mika Tanaka");
    expect(email.text).toBe("Search <b>please</b>\n\n— Mika Tanaka <mika@example.com> on /projects/p1\n\nAll feedback: https://kasa.test/feedback\n");
    expect(email.html).toContain("Search &lt;b&gt;please&lt;/b&gt;");
    expect(email.html).toContain("Mika Tanaka &lt;mika@example.com&gt; on /projects/p1");
    expect(renderFeedback({ body: "x", page: null, author: null }, "u").subject).toBe("Kasa feedback from a deleted user");
  });
});

describe.skipIf(!process.env.DATABASE_URL)("emailFeedback", () => {
  let testDb: TestDatabase;
  const db = () => testDb.db;
  const userId = randomUUID();
  const sent: Email[] = [];
  const mailer: Mailer = { kind: "resend", send: async (e) => void sent.push(e) };
  const deps = () => ({ db: db(), mailer, to: "petr@example.com", appUrl: "https://kasa.test/" });

  beforeAll(async () => {
    testDb = await createTestDatabase(process.env.DATABASE_URL!);
    await db().insert(schema.users).values({ id: userId, name: "Mika Tanaka", email: `mika-${userId}@example.com` });
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  const add = async () => (await db().insert(schema.feedback).values({ userId, body: "Love it", page: "/" }).returning())[0]!.id;
  const emailedAt = async (id: string) => (await db().select().from(schema.feedback).where(eq(schema.feedback.id, id)))[0]!.emailedAt;

  it("emails Petr once, with Reply-To set to the sender", async () => {
    const id = await add();
    await emailFeedback(deps(), id);
    expect(sent).toEqual([
      expect.objectContaining({
        to: "petr@example.com",
        subject: "Kasa feedback from Mika Tanaka",
        headers: { "Reply-To": `mika-${userId}@example.com` },
        idempotencyKey: `feedback-${id}`,
      }),
    ]);
    expect(sent[0]!.text).toContain("https://kasa.test/feedback");
    expect(await emailedAt(id)).not.toBeNull();

    // A retried job doesn't send it again.
    await emailFeedback(deps(), id);
    expect(sent).toHaveLength(1);
  });

  it("without FEEDBACK_EMAIL it only keeps the message", async () => {
    const id = await add();
    await emailFeedback({ ...deps(), to: undefined }, id);
    expect(sent).toEqual([]);
    expect(await emailedAt(id)).toBeNull();
  });

  it("ignores unknown ids", async () => {
    await emailFeedback(deps(), randomUUID());
    expect(sent).toEqual([]);
  });
});
