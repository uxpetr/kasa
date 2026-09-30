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
/** Reactions follow the same rule as adding: owners and editors, not while archived (D-003, D-140). */
export const canReact = canAdd;
/** Authors delete their own entries; the owner deletes anyone's, the bot's included (D-015). Not while archived. */
export const canDeleteEntry = (a: Access | null, authorId: string | null, userId: string) =>
  !!a && !a.archived && (a.role === "owner" || (authorId !== null && authorId === userId));
/** Only the owner changes roles and removes members (D-169); not while archived (D-140). */
export const canManageMembers = (a: Access | null) => !!a && !a.archived && a.role === "owner";
/** Everyone but the owner can leave, archived or not (D-169). */
export const canLeave = (a: Access | null) => !!a && a.role !== "owner";
/** Owners and editors change categories: move entries, rename, merge, remove, add, undo (D-201). Not while archived. */
export const canEditCategories = canAdd;
