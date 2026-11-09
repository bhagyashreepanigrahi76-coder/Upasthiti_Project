import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "./db";
import { readSession } from "./session";
import { canOpenPortal, type PortalKey, type RoleName } from "./roles";

// Data Access Layer for authentication and authorisation.
//
// Rules (PRD §3: "every action is checked on the server"):
// - Every page calls requirePortal() or requireRole() before reading data.
// - Every server action and route handler re-checks with requireRole().
// - Roles are always read from the database, never trusted from the cookie.
//   proxy.ts only does a fast first check for redirects.

export type RoleScope = {
  role: RoleName;
  departmentId: string | null;
  year: number | null;
  sectionId: string | null;
  subjectId: string | null;
};

export type CurrentUser = {
  id: string;
  collegeId: string;
  name: string;
  email: string | null;
  phone: string | null;
  mustChangePassword: boolean;
  roles: RoleName[];
  scopes: RoleScope[];
};

/** The signed-in user, or null. Cached for the duration of one request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await readSession();
  if (!session) return null;

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      collegeId: true,
      name: true,
      email: true,
      phone: true,
      isActive: true,
      mustChangePassword: true,
      sessionVersion: true,
      roles: {
        select: { role: true, departmentId: true, year: true, sectionId: true, subjectId: true },
      },
    },
  });
  // A password reset or deactivation bumps sessionVersion, ending old sessions.
  if (!user || !user.isActive || user.sessionVersion !== session.sv) return null;

  return {
    id: user.id,
    collegeId: user.collegeId,
    name: user.name,
    email: user.email,
    phone: user.phone,
    mustChangePassword: user.mustChangePassword,
    roles: [...new Set(user.roles.map((r) => r.role))],
    scopes: user.roles,
  };
});

/**
 * Redirects to login when nobody (or a deactivated user) is signed in, and to
 * first-login setup while the user still has to verify and set a password.
 */
export async function requireUser(opts: { allowPendingSetup?: boolean } = {}): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (user) {
    if (user.mustChangePassword && !opts.allowPendingSetup) redirect("/account/setup");
    return user;
  }
  // A cookie that no longer maps to an active user must be cleared, which a
  // page cannot do while rendering, so hand off to a route handler.
  const session = await readSession();
  redirect(session ? "/auth/reset" : "/login");
}

/** Requires at least one of the given roles. */
export async function requireRole(...roles: RoleName[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.roles.some((r) => roles.includes(r))) redirect("/forbidden");
  return user;
}

/** Requires access to a whole portal (e.g. "teacher" accepts TEACHER or MENTOR). */
export async function requirePortal(portal: PortalKey): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canOpenPortal(user.roles, portal)) redirect("/forbidden");
  return user;
}

/** Department IDs this user has a given role for (e.g. which departments a HOD runs). */
export function departmentsFor(user: CurrentUser, role: RoleName): string[] {
  return user.scopes
    .filter((s) => s.role === role && s.departmentId)
    .map((s) => s.departmentId as string);
}

/** For route handlers: the user or null, without redirects. */
export async function currentUserForApi(): Promise<CurrentUser | null> {
  const user = await getCurrentUser();
  return user && !user.mustChangePassword ? user : null;
}

/** The student profile of the signed-in student, or a redirect. */
export async function requireStudent() {
  const user = await requireRole("STUDENT");
  const student = await db.student.findUnique({
    where: { userId: user.id },
    include: { section: true, department: true, batch: true },
  });
  if (!student) redirect("/forbidden");
  return { user, student };
}

/** The teacher profile of the signed-in teacher, or null if not set up. */
export async function getTeacherProfile(userId: string) {
  return db.teacher.findUnique({ where: { userId } });
}

/**
 * Can this user approve requests for this student? (FR-11, FR-17: class
 * coordinator of the student, or HOD of the student's department.)
 */
export async function canApproveForStudent(
  user: CurrentUser,
  student: { mentorId: string | null; departmentId: string },
): Promise<boolean> {
  if (departmentsFor(user, "HOD").includes(student.departmentId)) return true;
  if (user.roles.includes("MENTOR") && student.mentorId) {
    const teacher = await getTeacherProfile(user.id);
    return teacher?.id === student.mentorId;
  }
  return false;
}
