"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { hashPassword, temporaryPassword } from "@/lib/password";
import { collegeIdSchema, optionalEmail, optionalPhone } from "@/lib/password-policy";
import { type ActionState, failure, formValues, fromZodError, success } from "@/lib/action-state";
import { isUniqueViolation } from "@/lib/db-errors";

const id = z.string().min(1);

const baseUser = z.object({
  collegeId: collegeIdSchema,
  name: z.string().trim().min(2, "Enter the full name").max(100),
  email: optionalEmail,
  phone: optionalPhone,
});

const studentFields = z.object({
  sectionId: id,
  batchId: z.string().optional(),
  mentorId: z.string().optional(),
  admissionYear: z.coerce.number().int().min(2000).max(2100),
  dateOfBirth: z.string().optional(),
  parentName: z.string().trim().min(2, "Enter the parent's name").max(100),
  parentEmail: z.string().trim().toLowerCase().pipe(z.email("Enter a valid parent email")),
  parentPhone: optionalPhone,
  relationship: z.enum(["Father", "Mother", "Guardian"]).default("Guardian"),
});

const teacherFields = z.object({
  departmentId: id,
  designation: z.string().trim().max(80).optional(),
  makeHod: z.string().optional(),
  mentorSectionId: z.string().optional(),
});

const parentFields = z.object({
  studentRollNos: z.string().min(1, "Enter at least one student roll number"),
  relationship: z.enum(["Father", "Mother", "Guardian"]).default("Guardian"),
});

/** Creates any kind of user with a one-time temporary password (FR-1). */
export async function createUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const values = formValues(formData);
  const kind = values.kind;
  const base = baseUser.safeParse(values);
  if (!base.success) return fromZodError(base.error);

  const tempPassword = temporaryPassword();
  const passwordHash = await hashPassword(tempPassword);
  const common = { ...base.data, passwordHash, mustChangePassword: true };

  try {
    let userId: string;
    if (kind === "STUDENT") {
      const parsed = studentFields.safeParse(values);
      if (!parsed.success) return fromZodError(parsed.error);
      const s = parsed.data;
      const section = await db.section.findUnique({ where: { id: s.sectionId } });
      if (!section) return failure("Section not found.");
      const user = await db.user.create({
        data: {
          ...common,
          roles: { create: [{ role: "STUDENT", departmentId: section.departmentId, year: section.year, sectionId: section.id }] },
          student: {
            create: {
              rollNo: base.data.collegeId,
              departmentId: section.departmentId,
              sectionId: section.id,
              year: section.year,
              batchId: s.batchId || null,
              mentorId: s.mentorId || null,
              admissionYear: s.admissionYear,
              dateOfBirth: s.dateOfBirth ? new Date(s.dateOfBirth) : null,
            },
          },
        },
        include: { student: true },
      });
      // Siblings share one parent record (matched by email).
      const parent =
        (await db.parent.findFirst({ where: { email: s.parentEmail } })) ??
        (await db.parent.create({ data: { name: s.parentName, email: s.parentEmail, phone: s.parentPhone } }));
      await db.parentStudent.create({
        data: { parentId: parent.id, studentId: user.student!.id, relationship: s.relationship },
      });
      userId = user.id;
    } else if (kind === "TEACHER") {
      const parsed = teacherFields.safeParse(values);
      if (!parsed.success) return fromZodError(parsed.error);
      const t = parsed.data;
      const roles: { role: Role; departmentId?: string; year?: number; sectionId?: string }[] = [
        { role: "TEACHER", departmentId: t.departmentId },
      ];
      if (t.makeHod) roles.push({ role: "HOD", departmentId: t.departmentId });
      let mentorSection = null;
      if (t.mentorSectionId) {
        mentorSection = await db.section.findUnique({ where: { id: t.mentorSectionId } });
        if (mentorSection) {
          roles.push({ role: "MENTOR", departmentId: mentorSection.departmentId, year: mentorSection.year, sectionId: mentorSection.id });
        }
      }
      const user = await db.user.create({
        data: {
          ...common,
          roles: { create: roles },
          teacher: { create: { departmentId: t.departmentId, designation: t.designation } },
        },
        include: { teacher: true },
      });
      if (mentorSection) {
        await db.student.updateMany({ where: { sectionId: mentorSection.id }, data: { mentorId: user.teacher!.id } });
      }
      userId = user.id;
    } else if (kind === "PARENT") {
      const parsed = parentFields.safeParse(values);
      if (!parsed.success) return fromZodError(parsed.error);
      const rollNos = parsed.data.studentRollNos.split(/[\s,;]+/).filter(Boolean).map((r) => r.toUpperCase());
      const students = await db.student.findMany({ where: { rollNo: { in: rollNos } } });
      const missing = rollNos.filter((r) => !students.some((s) => s.rollNo === r));
      if (missing.length) return { fieldErrors: { studentRollNos: `Not found: ${missing.join(", ")}` }, error: "Check the roll numbers." };
      if (!base.data.email) return { fieldErrors: { email: "Parents need an email for reports" }, error: "Email is required." };
      const user = await db.user.create({
        data: {
          ...common,
          roles: { create: [{ role: "PARENT" }] },
          parent: {
            create: {
              name: base.data.name,
              email: base.data.email,
              phone: base.data.phone,
              students: {
                create: students.map((s) => ({ studentId: s.id, relationship: parsed.data.relationship })),
              },
            },
          },
        },
      });
      userId = user.id;
    } else if (kind === "ADMIN") {
      const user = await db.user.create({ data: { ...common, roles: { create: [{ role: "ADMIN" }] } } });
      userId = user.id;
    } else {
      return failure("Choose what kind of user to create.");
    }

    await logAudit({ actorId: admin.id, action: "USER_CREATED", entityType: "User", entityId: userId, details: { kind, collegeId: base.data.collegeId } });
  } catch (err) {
    if (isUniqueViolation(err)) return failure("That college ID or email is already used by another account.");
    throw err;
  }
  refresh();
  return success(
    `${base.data.name} (${base.data.collegeId}) created. They sign in with this temporary password, then verify a code and choose their own:`,
    { secret: tempPassword },
  );
}

export async function updateProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const parsed = z
    .object({ id, name: z.string().trim().min(2).max(100), email: optionalEmail, phone: optionalPhone })
    .safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { id: userId, ...data } = parsed.data;
  try {
    await db.user.update({ where: { id: userId }, data: { ...data, email: data.email ?? null, phone: data.phone ?? null } });
  } catch (err) {
    if (isUniqueViolation(err)) return failure("That email is already used by another account.");
    throw err;
  }
  await logAudit({ actorId: admin.id, action: "USER_UPDATED", entityType: "User", entityId: userId, details: data });
  refresh();
  return success("Profile saved.");
}

export async function updateStudentPlacement(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const parsed = z
    .object({ studentId: id, sectionId: id, batchId: z.string().optional(), mentorId: z.string().optional() })
    .safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { studentId, sectionId, batchId, mentorId } = parsed.data;
  const [student, section, batch] = await Promise.all([
    db.student.findUnique({ where: { id: studentId } }),
    db.section.findUnique({ where: { id: sectionId } }),
    batchId ? db.batch.findUnique({ where: { id: batchId } }) : null,
  ]);
  if (!student || !section) return failure("Student or section not found.");
  if (batch && batch.sectionId !== sectionId) return failure("That batch belongs to a different section.");

  await db.$transaction([
    db.student.update({
      where: { id: studentId },
      data: { sectionId, departmentId: section.departmentId, year: section.year, batchId: batchId || null, mentorId: mentorId || null },
    }),
    db.userRole.updateMany({
      where: { userId: student.userId, role: "STUDENT" },
      data: { sectionId, departmentId: section.departmentId, year: section.year },
    }),
  ]);
  await logAudit({ actorId: admin.id, action: "STUDENT_PLACEMENT_UPDATED", entityType: "Student", entityId: studentId, details: parsed.data });
  refresh();
  return success("Section, batch and coordinator saved.");
}

export async function updateTeacher(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const parsed = z
    .object({ teacherId: id, departmentId: id, designation: z.string().trim().max(80).optional() })
    .safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { teacherId, ...data } = parsed.data;
  await db.teacher.update({ where: { id: teacherId }, data: { departmentId: data.departmentId, designation: data.designation ?? null } });
  await logAudit({ actorId: admin.id, action: "TEACHER_UPDATED", entityType: "Teacher", entityId: teacherId, details: data });
  refresh();
  return success("Teacher details saved.");
}

/** Adds a scoped staff role: HOD (department), MENTOR (section), TEACHER, ADMIN. */
export async function addRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const parsed = z
    .object({
      userId: id,
      role: z.enum(["ADMIN", "HOD", "TEACHER", "MENTOR", "LIBRARIAN"]),
      departmentId: z.string().optional(),
      sectionId: z.string().optional(),
    })
    .safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { userId, role, departmentId, sectionId } = parsed.data;

  const user = await db.user.findUnique({ where: { id: userId }, include: { teacher: true, roles: true } });
  if (!user) return failure("User not found.");
  if ((role === "TEACHER" || role === "MENTOR" || role === "HOD") && !user.teacher) {
    return failure("Only teachers can be given teaching roles. Create the account as a teacher.");
  }

  let data: { role: Role; departmentId?: string; year?: number; sectionId?: string } = { role };
  if (role === "HOD") {
    if (!departmentId) return { fieldErrors: { departmentId: "Choose the department" }, error: "Choose the department." };
    data = { role, departmentId };
  } else if (role === "MENTOR") {
    const section = sectionId ? await db.section.findUnique({ where: { id: sectionId } }) : null;
    if (!section) return { fieldErrors: { sectionId: "Choose the section" }, error: "Choose the section." };
    data = { role, departmentId: section.departmentId, year: section.year, sectionId: section.id };
  } else if (role === "TEACHER") {
    data = { role, departmentId: user.teacher!.departmentId };
  }

  const duplicate = user.roles.some(
    (r) => r.role === data.role && (r.departmentId ?? undefined) === data.departmentId && (r.sectionId ?? undefined) === data.sectionId,
  );
  if (duplicate) return failure("The user already has that role.");

  await db.userRole.create({ data: { userId, ...data } });
  if (role === "MENTOR" && data.sectionId) {
    // The coordinator becomes mentor of every student in that section.
    await db.student.updateMany({ where: { sectionId: data.sectionId }, data: { mentorId: user.teacher!.id } });
  }
  await logAudit({ actorId: admin.id, action: "ROLE_ADDED", entityType: "User", entityId: userId, details: data });
  refresh();
  return success("Role added.");
}

export async function removeRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const roleId = String(formData.get("id") ?? "");
  const role = await db.userRole.findUnique({ where: { id: roleId } });
  if (!role) return failure("Role not found.");
  if (role.userId === admin.id && role.role === "ADMIN") return failure("You cannot remove your own admin role.");
  if (role.role === "STUDENT" || role.role === "PARENT") return failure("Student and parent roles belong to the profile and cannot be removed here.");
  await db.userRole.delete({ where: { id: roleId } });
  await logAudit({ actorId: admin.id, action: "ROLE_REMOVED", entityType: "User", entityId: role.userId, details: { role: role.role, departmentId: role.departmentId, sectionId: role.sectionId } });
  refresh();
  return success("Role removed.");
}

export async function setUserActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const userId = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";
  if (userId === admin.id && !active) return failure("You cannot deactivate your own account.");
  await db.user.update({
    where: { id: userId },
    // Deactivating also ends every open session.
    data: active ? { isActive: true } : { isActive: false, sessionVersion: { increment: 1 } },
  });
  await logAudit({ actorId: admin.id, action: active ? "USER_ACTIVATED" : "USER_DEACTIVATED", entityType: "User", entityId: userId });
  refresh();
  return success(active ? "Account activated." : "Account deactivated and signed out everywhere.");
}

export async function resetUserPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const userId = String(formData.get("id") ?? "");
  const tempPassword = temporaryPassword();
  await db.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(tempPassword),
      mustChangePassword: true,
      failedLoginCount: 0,
      lockedUntil: null,
      sessionVersion: { increment: 1 },
    },
  });
  await logAudit({ actorId: admin.id, action: "PASSWORD_RESET_BY_ADMIN", entityType: "User", entityId: userId });
  refresh();
  return success("Password reset and all sessions ended. Temporary password:", { secret: tempPassword });
}

export async function unlockUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const userId = String(formData.get("id") ?? "");
  await db.user.update({ where: { id: userId }, data: { failedLoginCount: 0, lockedUntil: null } });
  await logAudit({ actorId: admin.id, action: "USER_UNLOCKED", entityType: "User", entityId: userId });
  refresh();
  return success("Account unlocked.");
}

/** FR-40: a student can have several parent emails. Siblings share a parent record. */
export async function addParentContact(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const parsed = z
    .object({
      studentId: id,
      name: z.string().trim().min(2, "Enter the name").max(100),
      email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
      phone: optionalPhone,
      relationship: z.enum(["Father", "Mother", "Guardian"]).default("Guardian"),
    })
    .safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const p = parsed.data;
  const parent = (await db.parent.findFirst({ where: { email: p.email } })) ?? (await db.parent.create({ data: { name: p.name, email: p.email, phone: p.phone } }));
  const exists = await db.parentStudent.findUnique({ where: { parentId_studentId: { parentId: parent.id, studentId: p.studentId } } });
  if (exists) return failure("That parent is already linked to this student.");
  await db.parentStudent.create({ data: { parentId: parent.id, studentId: p.studentId, relationship: p.relationship } });
  await logAudit({ actorId: admin.id, action: "PARENT_CONTACT_ADDED", entityType: "Student", entityId: p.studentId, details: { email: p.email } });
  refresh();
  return success("Parent contact added. They will receive the monthly reports.");
}

/** FR-40: only an admin can let a parent stop critical alerts. */
export async function setCriticalOptOut(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const parentId = String(formData.get("id") ?? "");
  const allow = formData.get("allow") === "true";
  await db.parent.update({ where: { id: parentId }, data: { criticalOptOutApproved: allow } });
  await logAudit({ actorId: admin.id, action: allow ? "PARENT_CRITICAL_OPT_OUT_APPROVED" : "PARENT_CRITICAL_OPT_OUT_REVOKED", entityType: "Parent", entityId: parentId });
  refresh();
  return success(allow ? "This parent will no longer get critical alerts." : "Critical alerts are on again for this parent.");
}
