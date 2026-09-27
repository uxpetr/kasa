import { randomUUID } from "node:crypto";
import { eq, schema } from "@kasa/db";
import { createTestDatabase, type TestDatabase } from "@kasa/db/testing";
import { setAnalyticsSink, type TrackedEvent } from "@kasa/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptInvite,
  changeRole,
  createInvite,
  createProject,
  currentInvite,
  INVITE_TTL_MS,
  listProjects,
  previewInvite,
  removeMember,
  revokeInvites,
  updateProject,
} from "./projects";

const ready = Boolean(process.env.DATABASE_URL);

describe.skipIf(!ready)("projects and invites", () => {
  let testDb: TestDatabase;
  const events: TrackedEvent[] = [];
  let restoreSink: () => void;
  const u = { owner: randomUUID(), editor: randomUUID(), viewer: randomUUID(), outsider: randomUUID(), joiner: randomUUID() };
  const db = () => testDb.db;

  beforeAll(async () => {
    testDb = await createTestDatabase(process.env.DATABASE_URL!);
    await testDb.db
      .insert(schema.users)
      .values(Object.entries(u).map(([name, id]) => ({ id, name, email: `${name}-${id}@example.com` })));
    restoreSink = setAnalyticsSink((e) => {
      events.push(e);
    });
  });

  afterAll(async () => {
    restoreSink?.();
    await testDb?.drop();
  });

  beforeEach(() => {
    events.length = 0;
    vi.useRealTimers();
  });

  /** A project owned by u.owner with an editor and a viewer. */
  async function groupProject(name = "Japan 2027") {
    const created = await createProject(db(), u.owner, { name });
    if (!created.ok) throw new Error(created.error);
    await db()
      .insert(schema.memberships)
      .values([
        { projectId: created.value.id, userId: u.editor, role: "editor" },
        { projectId: created.value.id, userId: u.viewer, role: "viewer" },
      ]);
    events.length = 0;
    return created.value.id;
  }

  async function inviteToken(projectId: string) {
    const invite = await createInvite(db(), u.owner, projectId);
    if (!invite.ok) throw new Error(invite.error);
    return invite.value.token;
  }

  describe("create and list", () => {
    it("makes the creator the owner and emits project_created without the name", async () => {
      const res = await createProject(db(), u.owner, { name: "  Wedding   ideas " });
      expect(res).toMatchObject({ ok: true, value: { name: "Wedding ideas", role: "owner", memberCount: 1 } });
      if (!res.ok) return;
      expect(events).toEqual([expect.objectContaining({ event: "project_created", userId: u.owner, properties: { projectId: res.value.id, personal: false } })]);
      expect(await listProjects(db(), u.owner)).toContainEqual(expect.objectContaining({ id: res.value.id, role: "owner" }));
    });

    it("rejects missing, blank, and overlong names", async () => {
      for (const name of [undefined, 42, "   ", "x".repeat(81)]) {
        expect(await createProject(db(), u.owner, { name })).toMatchObject({ ok: false, status: 400 });
      }
      expect(events).toHaveLength(0);
    });

    it("lists only the user's own live projects, with roles and member counts", async () => {
      const id = await groupProject();
      const deleted = await groupProject("Gone");
      await db().update(schema.projects).set({ deletedAt: new Date() }).where(eq(schema.projects.id, deleted));

      expect(await listProjects(db(), u.viewer)).toContainEqual(expect.objectContaining({ id, role: "viewer", memberCount: 3 }));
      expect((await listProjects(db(), u.viewer)).map((p) => p.id)).not.toContain(deleted);
      expect((await listProjects(db(), u.outsider)).map((p) => p.id)).not.toContain(id);
    });
  });

  describe("rename", () => {
    it("lets the owner and editors rename", async () => {
      const id = await groupProject();
      expect(await updateProject(db(), u.owner, id, { name: "Japan 2028" })).toMatchObject({ ok: true, value: { name: "Japan 2028" } });
      expect(await updateProject(db(), u.editor, id, { name: "Japan 2029" })).toMatchObject({ ok: true, value: { name: "Japan 2029" } });
    });

    it("refuses viewers with 403 and hides the project from outsiders with 404", async () => {
      const id = await groupProject();
      expect(await updateProject(db(), u.viewer, id, { name: "Mine now" })).toMatchObject({ ok: false, status: 403 });
      expect(await updateProject(db(), u.outsider, id, { name: "Mine now" })).toMatchObject({ ok: false, status: 404 });
      expect(await updateProject(db(), u.owner, "not-a-uuid", { name: "x" })).toMatchObject({ ok: false, status: 404 });
      expect(await updateProject(db(), u.owner, randomUUID(), { name: "x" })).toMatchObject({ ok: false, status: 404 });
    });

    it("validates the body", async () => {
      const id = await groupProject();
      expect(await updateProject(db(), u.owner, id, {})).toMatchObject({ status: 400 });
      expect(await updateProject(db(), u.owner, id, { name: " " })).toMatchObject({ status: 400 });
      expect(await updateProject(db(), u.owner, id, { archived: "yes" })).toMatchObject({ status: 400 });
    });
  });

  describe("archive", () => {
    it("is owner-only", async () => {
      const id = await groupProject();
      expect(await updateProject(db(), u.editor, id, { archived: true })).toMatchObject({ ok: false, status: 403 });
      expect(await updateProject(db(), u.viewer, id, { archived: true })).toMatchObject({ ok: false, status: 403 });
      expect(await updateProject(db(), u.outsider, id, { archived: true })).toMatchObject({ ok: false, status: 404 });
    });

    it("makes the project read-only for everyone until the owner unarchives it", async () => {
      const id = await groupProject();
      const archived = await updateProject(db(), u.owner, id, { archived: true });
      expect(archived).toMatchObject({ ok: true, value: { archivedAt: expect.any(Date) } });

      // Still listed (in the Archived section), but no renames or new invites.
      expect(await listProjects(db(), u.editor)).toContainEqual(expect.objectContaining({ id, archivedAt: expect.any(Date) }));
      expect(await updateProject(db(), u.editor, id, { name: "x" })).toMatchObject({ status: 403 });
      expect(await updateProject(db(), u.owner, id, { name: "x" })).toMatchObject({ status: 403 });
      expect(await createInvite(db(), u.owner, id)).toMatchObject({ status: 403 });

      expect(await updateProject(db(), u.owner, id, { archived: false, name: "Back" })).toMatchObject({
        ok: true,
        value: { archivedAt: null, name: "Back" },
      });
      expect(await updateProject(db(), u.editor, id, { name: "Again" })).toMatchObject({ ok: true });
    });

    it("keeps the first archive time when archived twice", async () => {
      const id = await groupProject();
      const first = await updateProject(db(), u.owner, id, { archived: true });
      const second = await updateProject(db(), u.owner, id, { archived: true });
      if (!first.ok || !second.ok) throw new Error("archive failed");
      expect(second.value.archivedAt).toEqual(first.value.archivedAt);
    });
  });

  describe("members (P-15)", () => {
    const roleOf = async (projectId: string, userId: string) =>
      (await db().select({ role: schema.memberships.role, userId: schema.memberships.userId }).from(schema.memberships).where(eq(schema.memberships.projectId, projectId))).find(
        (m) => m.userId === userId,
      )?.role ?? null;

    it("lets only the owner change roles, never the owner's own", async () => {
      const projectId = await groupProject();
      expect(await changeRole(db(), u.owner, projectId, u.editor, "viewer")).toEqual({ ok: true, value: { id: u.editor, role: "viewer" } });
      expect(await roleOf(projectId, u.editor)).toBe("viewer");
      expect(await changeRole(db(), u.owner, projectId, u.viewer, "editor")).toMatchObject({ ok: true });

      expect(await changeRole(db(), u.viewer, projectId, u.editor, "editor")).toMatchObject({ ok: false, status: 403 });
      expect(await changeRole(db(), u.editor, projectId, u.viewer, "viewer")).toMatchObject({ ok: false, status: 403 });
      expect(await changeRole(db(), u.outsider, projectId, u.editor, "viewer")).toMatchObject({ ok: false, status: 404 });
      expect(await changeRole(db(), u.owner, projectId, u.owner, "viewer")).toMatchObject({ ok: false, status: 403 });
      expect(await changeRole(db(), u.owner, projectId, u.editor, "owner")).toMatchObject({ ok: false, status: 400 });
      expect(await changeRole(db(), u.owner, projectId, u.outsider, "viewer")).toMatchObject({ ok: false, status: 404 });
      expect(await changeRole(db(), u.owner, projectId, "nope", "viewer")).toMatchObject({ ok: false, status: 404 });
    });

    it("lets only the owner remove members; entries stay (D-015)", async () => {
      const projectId = await groupProject();
      await db().insert(schema.entries).values({ projectId, authorId: u.editor, kind: "note", body: "Mine" });
      expect(await removeMember(db(), u.editor, projectId, u.viewer)).toMatchObject({ ok: false, status: 403 });
      expect(await removeMember(db(), u.outsider, projectId, u.viewer)).toMatchObject({ ok: false, status: 404 });
      expect(await removeMember(db(), u.editor, projectId, u.owner)).toMatchObject({ ok: false, status: 403 });
      expect(await removeMember(db(), u.owner, projectId, u.owner)).toMatchObject({ ok: false, status: 403 });
      expect(await removeMember(db(), u.owner, projectId, u.outsider)).toMatchObject({ ok: false, status: 404 });

      expect(await removeMember(db(), u.owner, projectId, u.editor)).toEqual({ ok: true, value: { removed: u.editor } });
      expect(await roleOf(projectId, u.editor)).toBeNull();
      const entries = await db().select().from(schema.entries).where(eq(schema.entries.projectId, projectId));
      expect(entries.map((e) => e.body)).toEqual(["Mine"]);
    });

    it("lets everyone but the owner leave, even while archived", async () => {
      const projectId = await groupProject();
      await updateProject(db(), u.owner, projectId, { archived: true });
      expect(await removeMember(db(), u.owner, projectId, u.editor)).toMatchObject({ ok: false, status: 403 });
      expect(await changeRole(db(), u.owner, projectId, u.editor, "viewer")).toMatchObject({ ok: false, status: 403 });
      expect(await removeMember(db(), u.viewer, projectId, u.viewer)).toMatchObject({ ok: true });
      expect(await removeMember(db(), u.editor, projectId, u.editor)).toMatchObject({ ok: true });
      expect(await removeMember(db(), u.owner, projectId, u.owner)).toMatchObject({ ok: false, status: 403 });
      expect(await roleOf(projectId, u.owner)).toBe("owner");
    });
  });

  describe("invites", () => {
    it("lets only the owner create, see, and revoke links", async () => {
      const id = await groupProject();
      for (const who of [u.editor, u.viewer]) {
        expect(await createInvite(db(), who, id)).toMatchObject({ ok: false, status: 403 });
        expect(await currentInvite(db(), who, id)).toMatchObject({ ok: false, status: 403 });
        expect(await revokeInvites(db(), who, id)).toMatchObject({ ok: false, status: 403 });
      }
      expect(await createInvite(db(), u.outsider, id)).toMatchObject({ ok: false, status: 404 });
      expect(await currentInvite(db(), u.outsider, id)).toMatchObject({ ok: false, status: 404 });
      expect(events).toHaveLength(0);
    });

    it("creates a 7-day link, emits invite_sent, and shows it again to the owner", async () => {
      const id = await groupProject();
      const before = Date.now();
      const invite = await createInvite(db(), u.owner, id);
      if (!invite.ok) throw new Error(invite.error);
      expect(invite.value.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(invite.value.expiresAt.getTime()).toBeGreaterThanOrEqual(before + INVITE_TTL_MS - 1000);
      expect(events).toEqual([
        expect.objectContaining({ event: "invite_sent", userId: u.owner, properties: { projectId: id, inviteId: invite.value.id } }),
      ]);
      expect(await currentInvite(db(), u.owner, id)).toEqual({ ok: true, value: invite.value });
    });

    it("is reusable: several people join with the same link as editors", async () => {
      const id = await groupProject();
      const token = await inviteToken(id);
      const second = randomUUID();
      await db().insert(schema.users).values({ id: second, name: "second", email: `second-${second}@example.com` });

      expect(await previewInvite(db(), u.joiner, token)).toEqual({
        ok: true,
        value: {
          projectId: id,
          projectName: "Japan 2027",
          memberCount: 3,
          inviterName: "owner",
          avatars: [
            { id: u.owner, initial: "O" },
            { id: u.editor, initial: "E" },
            { id: u.viewer, initial: "V" },
          ],
          alreadyMember: false,
        },
      });
      // Signed out: the same preview, never "already a member" (D-174).
      expect(await previewInvite(db(), null, token)).toMatchObject({ ok: true, value: { projectName: "Japan 2027", alreadyMember: false } });
      expect(await acceptInvite(db(), u.joiner, token)).toEqual({ ok: true, value: { projectId: id, role: "editor" } });
      expect(await acceptInvite(db(), second, token)).toEqual({ ok: true, value: { projectId: id, role: "editor" } });
      expect(events.filter((e) => e.event === "invite_accepted").map((e) => e.userId)).toEqual([u.joiner, second]);
      expect(await previewInvite(db(), u.joiner, token)).toMatchObject({ value: { alreadyMember: true, memberCount: 5 } });
    });

    it("never changes an existing member's role", async () => {
      const id = await groupProject();
      const token = await inviteToken(id);
      events.length = 0;
      expect(await acceptInvite(db(), u.viewer, token)).toEqual({ ok: true, value: { projectId: id, role: "viewer" } });
      expect(await acceptInvite(db(), u.owner, token)).toEqual({ ok: true, value: { projectId: id, role: "owner" } });
      expect(events).toHaveLength(0);
    });

    it("stops old links when a new one is made, and all links when revoked", async () => {
      const id = await groupProject();
      const old = await inviteToken(id);
      const fresh = await inviteToken(id);
      expect(await acceptInvite(db(), u.joiner, old)).toMatchObject({ ok: false, status: 410 });

      expect(await revokeInvites(db(), u.owner, id)).toEqual({ ok: true, value: { revoked: 1 } });
      expect(await acceptInvite(db(), u.joiner, fresh)).toMatchObject({ ok: false, status: 410 });
      expect(await currentInvite(db(), u.owner, id)).toEqual({ ok: true, value: null });
    });

    it("stops working after 7 days", async () => {
      const id = await groupProject();
      const token = await inviteToken(id);
      vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + INVITE_TTL_MS + 1000 });
      expect(await previewInvite(db(), u.joiner, token)).toMatchObject({ ok: false, status: 410 });
      expect(await acceptInvite(db(), u.joiner, token)).toMatchObject({ ok: false, status: 410 });
    });

    it("stops working while the project is archived or deleted", async () => {
      const id = await groupProject();
      const token = await inviteToken(id);
      await db().update(schema.projects).set({ archivedAt: new Date() }).where(eq(schema.projects.id, id));
      expect(await acceptInvite(db(), u.joiner, token)).toMatchObject({ ok: false, status: 410 });
      await db().update(schema.projects).set({ deletedAt: new Date() }).where(eq(schema.projects.id, id));
      expect(await acceptInvite(db(), u.joiner, token)).toMatchObject({ ok: false, status: 404 });
    });

    it("rejects unknown and malformed tokens without revealing anything", async () => {
      for (const token of ["x".repeat(43), "short", "' or 1=1 --", undefined]) {
        expect(await previewInvite(db(), u.joiner, token)).toMatchObject({ ok: false, status: 404 });
        expect(await acceptInvite(db(), u.joiner, token)).toMatchObject({ ok: false, status: 404 });
      }
    });
  });
});
