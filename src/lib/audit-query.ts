import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { addDays, isDateKey, zonedDateTime } from "./dates";

/** Shared by the page and the CSV export so both apply the same filters. */
export async function auditWhere(sp: Record<string, string | undefined>): Promise<Prisma.AuditLogWhereInput> {
  const actor = sp.actor?.trim().toUpperCase();
  const actorUser = actor ? await db.user.findUnique({ where: { collegeId: actor }, select: { id: true } }) : null;
  return {
    ...(sp.action ? { action: { contains: sp.action.trim().toUpperCase() } } : {}),
    ...(actor ? { actorId: actorUser?.id ?? "none" } : {}),
    ...(sp.entity ? { entityType: sp.entity } : {}),
    ...(isDateKey(sp.from) || isDateKey(sp.to)
      ? {
          createdAt: {
            ...(isDateKey(sp.from) ? { gte: zonedDateTime(sp.from, "00:00") } : {}),
            ...(isDateKey(sp.to) ? { lt: zonedDateTime(addDays(sp.to, 1), "00:00") } : {}),
          },
        }
      : {}),
  };
}
