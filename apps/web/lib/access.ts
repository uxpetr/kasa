import { and, eq, isNull, schema, type Database } from "@kasa/db";

export type Role = (typeof schema.role.enumValues)[number];

export interface Access {
  role: Role;
  archived: boolean;
}

/** The user's role in a live (not deleted) project, or null when they aren't a member. */
export async function projectAccess(db: Database, userId: string, projectId: string): Promise<Access | null> {
  const [row] = await db
    .select({ role: schema.memberships.role, archivedAt: schema.projects.archivedAt })
    .from(schema.memberships)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.memberships.projectId))
    .where(
      and(
        eq(schema.memberships.userId, userId),
        eq(schema.memberships.projectId, projectId),
        isNull(schema.projects.deletedAt),
      ),
    );
  return row ? { role: row.role, archived: row.archivedAt !== null } : null;
}

// Every permission check lives here so routes can't drift apart (P-01).
/** Owners and editors add to the pile; viewers only read (D-003). Archived projects are read-only (D-140). */
export const canAdd = (a: Access | null) => !!a && !a.archived && (a.role === "owner" || a.role === "editor");
export const canRead = (a: Access | null) => a !== null;
/** Owner and editors rename (D-139), but not while archived. */
export const canRename = canAdd;
/** Only the owner invites (D-139); nobody joins an archived project. */
export const canInvite = (a: Access | null) => !!a && !a.archived && a.role === "owner";
/** Only the owner archives and unarchives (D-140). */
export const canArchive = (a: Access | null) => a?.role === "owner";
