import { and, eq, isNull, schema, type Database } from "@kasa/db";

export type Role = (typeof schema.role.enumValues)[number];

/** The user's role in a live (not deleted) project, or null when they aren't a member. */
export async function projectRole(db: Database, userId: string, projectId: string): Promise<Role | null> {
  const [row] = await db
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.memberships.projectId))
    .where(
      and(
        eq(schema.memberships.userId, userId),
        eq(schema.memberships.projectId, projectId),
        isNull(schema.projects.deletedAt),
      ),
    );
  return row?.role ?? null;
}

/** Owners and editors add to the pile; viewers only read (D-003). */
export const canAdd = (role: Role | null) => role === "owner" || role === "editor";
export const canRead = (role: Role | null) => role !== null;
