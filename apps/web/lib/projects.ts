// Projects and invites (P-01). Non-members get 404 so project ids can't be probed;
// members without the right role get 403. Permission rules live in ./access.
import { randomBytes } from "node:crypto";
import { and, count, desc, eq, gt, isNull, schema, sql, type Database, type SQL } from "@kasa/db";
import { track } from "@kasa/shared";
import { canArchive, canInvite, canLeave, canManageMembers, canRename, projectAccess, type Role } from "./access";
import { fail, isUuid, ok, type Result } from "./result";

export const MAX_PROJECT_NAME = 80;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // D-138

export interface ProjectSummary {
  id: string;
  name: string;
  role: Role;
  archivedAt: Date | null;
  createdAt: Date;
  memberCount: number;
}

export interface InviteLink {
  id: string;
  token: string;
  expiresAt: Date;
}

function parseName(value: unknown): Result<string> {
  if (typeof value !== "string") return fail(400, "name is required");
  const name = value.replace(/\s+/g, " ").trim();
  if (!name) return fail(400, "name is required");
  if (name.length > MAX_PROJECT_NAME) return fail(400, `name must be at most ${MAX_PROJECT_NAME} characters`);
  return ok(name);
}

export const PERSONAL_PROJECT_NAME = "My pile";

/** Creates a project with the creator as its owner. */
export async function createProject(
  db: Database,
  userId: string,
  input: { name?: unknown },
  options: { personal?: boolean } = {},
): Promise<Result<ProjectSummary>> {
  const name = parseName(input.name);
  if (!name.ok) return name;
  const project = await db.transaction(async (tx) => {
    const [row] = await tx.insert(schema.projects).values({ name: name.value, ownerId: userId }).returning();
    await tx.insert(schema.memberships).values({ projectId: row!.id, userId, role: "owner" });
    return row!;
  });
  await track("project_created", userId, { projectId: project.id, personal: options.personal ?? false });
  return ok({ id: project.id, name: project.name, role: "owner", archivedAt: null, createdAt: project.createdAt, memberCount: 1 });
}

/** Every user starts with a personal "My pile" (D-144). */
export async function createPersonalProject(db: Database, userId: string): Promise<void> {
  const res = await createProject(db, userId, { name: PERSONAL_PROJECT_NAME }, { personal: true });
  if (!res.ok) throw new Error(res.error);
}

/** The user's live projects, newest first; archived ones are included and flagged (D-140). */
export async function listProjects(db: Database, userId: string): Promise<ProjectSummary[]> {
  const memberCount = db
    .select({ projectId: schema.memberships.projectId, n: count().as("n") })
    .from(schema.memberships)
    .groupBy(schema.memberships.projectId)
    .as("member_count");
  const rows = await db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      role: schema.memberships.role,
      archivedAt: schema.projects.archivedAt,
      createdAt: schema.projects.createdAt,
      memberCount: memberCount.n,
    })
    .from(schema.memberships)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.memberships.projectId))
    .innerJoin(memberCount, eq(memberCount.projectId, schema.projects.id))
    .where(and(eq(schema.memberships.userId, userId), isNull(schema.projects.deletedAt)))
    .orderBy(desc(schema.projects.createdAt));
  return rows.map((r) => ({ ...r, memberCount: Number(r.memberCount) }));
}

/** Rename and/or archive: { name?: string, archived?: boolean }. */
export async function updateProject(
  db: Database,
  userId: string,
  projectId: string,
  input: { name?: unknown; archived?: unknown },
): Promise<Result<{ id: string; name: string; archivedAt: Date | null }>> {
  if (!isUuid(projectId)) return fail(404, "Project not found");
  const access = await projectAccess(db, userId, projectId);
  if (!access) return fail(404, "Project not found");
  if (input.name === undefined && input.archived === undefined) return fail(400, "Nothing to change");
  if (input.archived !== undefined && typeof input.archived !== "boolean") return fail(400, "archived must be true or false");

  const changes: { name?: string; archivedAt?: Date | null | SQL } = {};
  if (input.archived !== undefined) {
    if (!canArchive(access)) return fail(403, "Only the owner can archive this project");
    // Archiving twice keeps the first archive time.
    changes.archivedAt = input.archived ? sql`coalesce(${schema.projects.archivedAt}, now())` : null;
  }
  if (input.name !== undefined) {
    const name = parseName(input.name);
    if (!name.ok) return name;
    // Renaming counts as a change to the project, so check it against the state after this update.
    const after = { ...access, archived: input.archived ?? access.archived };
    if (!canRename(after)) {
      return fail(403, after.archived ? "Project is archived" : "Viewers can't rename this project");
    }
    changes.name = name.value;
  }
  const [row] = await db
    .update(schema.projects)
    .set(changes)
    .where(eq(schema.projects.id, projectId))
    .returning({ id: schema.projects.id, name: schema.projects.name, archivedAt: schema.projects.archivedAt });
  return ok(row!);
}

/** Everyone in the project with their role, owner first. Members only. */
export async function listMembers(
  db: Database,
  userId: string,
  projectId: string,
): Promise<Result<{ members: { id: string; name: string; role: Role }[] }>> {
  const access = isUuid(projectId) ? await projectAccess(db, userId, projectId) : null;
  if (!access) return fail(404, "Project not found");
  const members = await db
    .select({ id: schema.users.id, name: schema.users.name, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.projectId, projectId))
    .orderBy(sql`case ${schema.memberships.role} when 'owner' then 0 when 'editor' then 1 else 2 end`, schema.memberships.joinedAt);
  return ok({ members });
}

const memberWhere = (projectId: string, memberId: string) =>
  and(eq(schema.memberships.projectId, projectId), eq(schema.memberships.userId, memberId));

/** The owner makes a member an editor or a viewer (D-169). The owner's own role can't change. */
export async function changeRole(
  db: Database,
  userId: string,
  projectId: string,
  memberId: string,
  role: unknown,
): Promise<Result<{ id: string; role: Role }>> {
  const access = isUuid(projectId) ? await projectAccess(db, userId, projectId) : null;
  if (!access) return fail(404, "Project not found");
  if (!canManageMembers(access)) return fail(403, access.archived ? "Project is archived" : "Only the owner can change roles");
  if (role !== "editor" && role !== "viewer") return fail(400, "role must be editor or viewer");
  const target = isUuid(memberId) ? await projectAccess(db, memberId, projectId) : null;
  if (!target) return fail(404, "Member not found");
  if (target.role === "owner") return fail(403, "The owner's role can't change");
  await db.update(schema.memberships).set({ role }).where(memberWhere(projectId, memberId));
  return ok({ id: memberId, role });
}

/**
 * Removes a member (owner, D-169) or leaves (anyone but the owner). Their entries stay (D-015).
 * Deleting the membership fires a trigger that closes their live connection (migration 0011).
 */
export async function removeMember(db: Database, userId: string, projectId: string, memberId: string): Promise<Result<{ removed: string }>> {
  const access = isUuid(projectId) ? await projectAccess(db, userId, projectId) : null;
  if (!access) return fail(404, "Project not found");
  const leaving = memberId === userId;
  if (leaving && !canLeave(access)) return fail(403, "The owner can't leave; archive the pile instead");
  if (!leaving) {
    if (!canManageMembers(access)) return fail(403, access.archived ? "Project is archived" : "Only the owner can remove members");
    const target = isUuid(memberId) ? await projectAccess(db, memberId, projectId) : null;
    if (!target) return fail(404, "Member not found");
    if (target.role === "owner") return fail(403, "The owner can't be removed");
  }
  await db.delete(schema.memberships).where(memberWhere(projectId, memberId));
  return ok({ removed: memberId });
}

const liveInvite = (now: Date) => and(isNull(schema.invites.revokedAt), gt(schema.invites.expiresAt, now));

/** The project's current invite link, or null. Owner only. */
export async function currentInvite(db: Database, userId: string, projectId: string): Promise<Result<InviteLink | null>> {
  const access = isUuid(projectId) ? await projectAccess(db, userId, projectId) : null;
  if (!access) return fail(404, "Project not found");
  if (!canInvite(access)) return fail(403, access.archived ? "Project is archived" : "Only the owner can invite people");
  const [row] = await db
    .select({ id: schema.invites.id, token: schema.invites.token, expiresAt: schema.invites.expiresAt })
    .from(schema.invites)
    .where(and(eq(schema.invites.projectId, projectId), liveInvite(new Date())))
    .orderBy(desc(schema.invites.createdAt))
    .limit(1);
  return ok(row ?? null);
}

/** A new invite link valid for 7 days; any earlier links stop working (D-138). Owner only. */
export async function createInvite(db: Database, userId: string, projectId: string): Promise<Result<InviteLink>> {
  const access = isUuid(projectId) ? await projectAccess(db, userId, projectId) : null;
  if (!access) return fail(404, "Project not found");
  if (!canInvite(access)) return fail(403, access.archived ? "Project is archived" : "Only the owner can invite people");

  const now = new Date();
  const invite = await db.transaction(async (tx) => {
    await tx
      .update(schema.invites)
      .set({ revokedAt: now })
      .where(and(eq(schema.invites.projectId, projectId), isNull(schema.invites.revokedAt)));
    const [row] = await tx
      .insert(schema.invites)
      .values({
        projectId,
        createdBy: userId,
        // 256 random bits: the link is the only credential needed to join.
        token: randomBytes(32).toString("base64url"),
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
      })
      .returning({ id: schema.invites.id, token: schema.invites.token, expiresAt: schema.invites.expiresAt });
    return row!;
  });
  await track("invite_sent", userId, { projectId, inviteId: invite.id });
  return ok(invite);
}

/** Stops every link for the project from working. Owner only. */
export async function revokeInvites(db: Database, userId: string, projectId: string): Promise<Result<{ revoked: number }>> {
  const access = isUuid(projectId) ? await projectAccess(db, userId, projectId) : null;
  if (!access) return fail(404, "Project not found");
  if (access.role !== "owner") return fail(403, "Only the owner can revoke invite links");
  const rows = await db
    .update(schema.invites)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.invites.projectId, projectId), isNull(schema.invites.revokedAt)))
    .returning({ id: schema.invites.id });
  return ok({ revoked: rows.length });
}

/** The project behind a usable invite token, or a failure saying why it can't be used. */
async function usableInvite(db: Database, token: unknown) {
  // Tokens are 43 base64url characters; anything else can't match, so skip the query.
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return fail<never>(404, "Invite not found");
  const [row] = await db
    .select({
      inviteId: schema.invites.id,
      projectId: schema.projects.id,
      projectName: schema.projects.name,
      expiresAt: schema.invites.expiresAt,
      revokedAt: schema.invites.revokedAt,
      archivedAt: schema.projects.archivedAt,
    })
    .from(schema.invites)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.invites.projectId))
    .where(and(eq(schema.invites.token, token), isNull(schema.projects.deletedAt)));
  if (!row) return fail<never>(404, "Invite not found");
  if (row.revokedAt || row.expiresAt <= new Date() || row.archivedAt) return fail<never>(410, "This invite link no longer works");
  return ok(row);
}

/** What a signed-in person sees before joining: the project name and whether they're already in. */
export async function previewInvite(
  db: Database,
  userId: string,
  token: unknown,
): Promise<Result<{ projectId: string; projectName: string; memberCount: number; alreadyMember: boolean }>> {
  const invite = await usableInvite(db, token);
  if (!invite.ok) return invite;
  const { projectId, projectName } = invite.value;
  const [members] = await db
    .select({ n: count(), me: sql<number>`count(*) filter (where ${schema.memberships.userId} = ${userId})` })
    .from(schema.memberships)
    .where(eq(schema.memberships.projectId, projectId));
  return ok({ projectId, projectName, memberCount: Number(members!.n), alreadyMember: Number(members!.me) > 0 });
}

/** Joins the project as editor; existing members keep their role (D-138). */
export async function acceptInvite(db: Database, userId: string, token: unknown): Promise<Result<{ projectId: string; role: Role }>> {
  const invite = await usableInvite(db, token);
  if (!invite.ok) return invite;
  const { projectId, inviteId } = invite.value;
  const inserted = await db
    .insert(schema.memberships)
    .values({ projectId, userId, role: "editor" })
    .onConflictDoNothing()
    .returning({ role: schema.memberships.role });
  if (inserted.length === 0) {
    const access = await projectAccess(db, userId, projectId);
    return ok({ projectId, role: access!.role });
  }
  await track("invite_accepted", userId, { projectId, inviteId });
  return ok({ projectId, role: "editor" });
}
