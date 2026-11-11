import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { departmentsFor, getTeacherProfile, type CurrentUser } from "./auth";

/**
 * Students whose requests this user may decide (FR-11, FR-17): their mentees
 * as class coordinator, plus every student in departments they head.
 * Returns null when the user approves for nobody.
 */
export async function approvalScope(user: CurrentUser): Promise<Prisma.StudentWhereInput | null> {
  const or: Prisma.StudentWhereInput[] = [];
  const hodDepartments = departmentsFor(user, "HOD");
  if (hodDepartments.length) or.push({ departmentId: { in: hodDepartments } });
  if (user.roles.includes("MENTOR")) {
    const teacher = await getTeacherProfile(user.id);
    if (teacher) or.push({ mentorId: teacher.id });
  }
  return or.length ? { OR: or } : null;
}

/** User IDs to notify about a student's new request: their coordinator and HODs. */
export async function approverUserIds(student: { mentorId: string | null; departmentId: string }): Promise<string[]> {
  const ids: string[] = [];
  if (student.mentorId) {
    const mentor = await db.teacher.findUnique({ where: { id: student.mentorId }, select: { userId: true } });
    if (mentor) ids.push(mentor.userId);
  }
  const hods = await db.userRole.findMany({
    where: { role: "HOD", departmentId: student.departmentId, user: { isActive: true } },
    select: { userId: true },
  });
  return [...new Set([...ids, ...hods.map((h) => h.userId)])];
}
