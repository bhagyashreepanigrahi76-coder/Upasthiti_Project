import "server-only";
import { db } from "./db";

export type NotificationInput = { title: string; body?: string; link?: string };

/** In-app notifications (FR-16, FR-35, FR-63). Push and email arrive on Days 8-9. */
export async function notifyUsers(userIds: string[], n: NotificationInput): Promise<number> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return 0;
  const result = await db.notification.createMany({
    data: unique.map((userId) => ({ userId, title: n.title, body: n.body, link: n.link })),
  });
  return result.count;
}

/** User IDs of active students matching a scope (empty scope = all students). */
export async function studentUserIds(scope: {
  departmentId?: string | null;
  year?: number | null;
  sectionId?: string | null;
}): Promise<string[]> {
  const students = await db.student.findMany({
    where: {
      status: "ACTIVE",
      ...(scope.departmentId ? { departmentId: scope.departmentId } : {}),
      ...(scope.year ? { year: scope.year } : {}),
      ...(scope.sectionId ? { sectionId: scope.sectionId } : {}),
    },
    select: { userId: true },
  });
  return students.map((s) => s.userId);
}

/** User IDs of teachers in a department (or all teachers). */
export async function teacherUserIds(departmentId?: string | null): Promise<string[]> {
  const teachers = await db.teacher.findMany({
    where: departmentId ? { departmentId } : {},
    select: { userId: true },
  });
  return teachers.map((t) => t.userId);
}

/** User IDs of all active admins (for device requests and exceptions). */
export async function adminUserIds(): Promise<string[]> {
  const admins = await db.user.findMany({ where: { isActive: true, roles: { some: { role: "ADMIN" } } }, select: { id: true } });
  return admins.map((a) => a.id);
}
