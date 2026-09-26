import { eq, schema } from "@kasa/db";
import { createTestDatabase, type TestDatabase } from "@kasa/db/testing";
import { setAnalyticsSink, type TrackedEvent } from "@kasa/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAuth } from "./create-auth";
import { listProjects } from "./projects";

const baseUrl = process.env.DATABASE_URL;

describe.skipIf(!baseUrl)("auth", () => {
  let testDb: TestDatabase;
  let auth: ReturnType<typeof createAuth>;
  const events: TrackedEvent[] = [];
  let restoreSink: () => void;

  beforeAll(async () => {
    testDb = await createTestDatabase(baseUrl!);
    auth = createAuth({ db: testDb.db, secret: "test-secret-0123456789abcdef0123456789", baseURL: "http://localhost:3000" });
    restoreSink = setAnalyticsSink((e) => {
      events.push(e);
    });
  });

  afterAll(async () => {
    restoreSink?.();
    await testDb?.drop();
  });

  afterEach(() => {
    events.length = 0;
    vi.useRealTimers();
  });

  /** Signs a user up the way the Google callback does: a user row, a Google account, a session. */
  async function signUp(email: string) {
    const ctx = await auth.$context;
    const { user } = await ctx.internalAdapter.createOAuthUser(
      { email, name: "Test User", emailVerified: true },
      { providerId: "google", accountId: `google-${email}` },
    );
    const session = await ctx.internalAdapter.createSession(user.id);
    return { user, session };
  }

  const bearer = (token: string) => new Headers({ authorization: `Bearer ${token}` });

  it("gives every new user a personal \"My pile\" (D-144)", async () => {
    const { user } = await signUp("pile@example.com");
    const projects = await listProjects(testDb.db, user.id);
    expect(projects).toEqual([expect.objectContaining({ name: "My pile", role: "owner", memberCount: 1 })]);
    expect(events).toContainEqual(
      expect.objectContaining({ event: "project_created", userId: user.id, properties: { projectId: projects[0]!.id, personal: true } }),
    );
  });

  it("creates a user row on first sign-in and emits signed_up, project_created (My pile), and signed_in", async () => {
    const { user } = await signUp("first@example.com");
    const [row] = await testDb.db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(row).toMatchObject({ email: "first@example.com", emailVerified: true });
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(events.map((e) => [e.event, e.userId])).toEqual([
      ["signed_up", user.id],
      ["project_created", user.id],
      ["signed_in", user.id],
    ]);
  });

  it("keeps analytics free of personal data", async () => {
    await signUp("private@example.com");
    expect(JSON.stringify(events)).not.toContain("private@example.com");
    expect(JSON.stringify(events)).not.toContain("Test User");
  });

  it("stores the Google account id on the account, not the user", async () => {
    const { user } = await signUp("google@example.com");
    const accounts = await testDb.db.select().from(schema.accounts).where(eq(schema.accounts.userId, user.id));
    expect(accounts).toEqual([expect.objectContaining({ providerId: "google", accountId: "google-google@example.com" })]);
  });

  it("returns no session without credentials", async () => {
    expect(await auth.api.getSession({ headers: new Headers() })).toBeNull();
  });

  describe("extension handoff", () => {
    it("exchanges a one-time code from the web session for a bearer token", async () => {
      const { user, session } = await signUp("ext@example.com");
      const { token: code } = await auth.api.generateOneTimeToken({ headers: bearer(session.token) });
      expect(code).toBeTruthy();

      const verified = await auth.api.verifyOneTimeToken({ body: { token: code } });
      expect(verified.user.id).toBe(user.id);

      const fromExtension = await auth.api.getSession({ headers: bearer(verified.session.token) });
      expect(fromExtension?.user.id).toBe(user.id);
    });

    it("stores codes hashed, not in plain text", async () => {
      const { session } = await signUp("hashed@example.com");
      const { token: code } = await auth.api.generateOneTimeToken({ headers: bearer(session.token) });
      const rows = await testDb.db.select().from(schema.verifications);
      expect(rows.some((r) => r.identifier.includes(code) || r.value.includes(code))).toBe(false);
    });

    it("accepts each code only once", async () => {
      const { session } = await signUp("once@example.com");
      const { token: code } = await auth.api.generateOneTimeToken({ headers: bearer(session.token) });
      await auth.api.verifyOneTimeToken({ body: { token: code } });
      await expect(auth.api.verifyOneTimeToken({ body: { token: code } })).rejects.toThrow();
    });

    it("accepts a code within three minutes", async () => {
      const { user, session } = await signUp("prompt@example.com");
      const { token: code } = await auth.api.generateOneTimeToken({ headers: bearer(session.token) });
      vi.useFakeTimers({ now: Date.now() + 2 * 60_000, toFake: ["Date"] });
      const verified = await auth.api.verifyOneTimeToken({ body: { token: code } });
      expect(verified.user.id).toBe(user.id);
    });

    it("rejects codes older than three minutes", async () => {
      const { session } = await signUp("late@example.com");
      const { token: code } = await auth.api.generateOneTimeToken({ headers: bearer(session.token) });
      vi.useFakeTimers({ now: Date.now() + 4 * 60_000, toFake: ["Date"] });
      await expect(auth.api.verifyOneTimeToken({ body: { token: code } })).rejects.toThrow();
    });

    it("won't issue a code without a session", async () => {
      await expect(auth.api.generateOneTimeToken({ headers: new Headers() })).rejects.toThrow();
    });
  });
});
