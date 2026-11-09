import "server-only";
import { z } from "zod";
import type { Role } from "@prisma/client";
import { db } from "./db";
import { parseFlexibleDate } from "./spreadsheet";
import { UNUSABLE_PASSWORD } from "./password";

// FR-2: bulk import of students and teachers from CSV / Excel.
// Rows are validated against the database and against each other before
// anything is written; the admin reviews a preview, then commits.

export const STUDENT_COLUMNS = [
  "name", "college_id", "year", "department", "section",
  "parent_name", "parent_email", "parent_phone",
  "email", "phone", "admission_year", "date_of_birth", "batch",
] as const;
export const STUDENT_REQUIRED = ["name", "college_id", "year", "department", "section", "parent_name", "parent_email"];

export const TEACHER_COLUMNS = ["name", "college_id", "department", "email", "phone", "designation", "roles", "mentor_section"] as const;
export const TEACHER_REQUIRED = ["name", "college_id", "department"];

export type StudentRow = {
  name: string; collegeId: string; email: string | null; phone: string | null;
  departmentId: string; year: number; sectionId: string; batchId: string | null;
  admissionYear: number; dateOfBirth: string | null;
  parentName: string; parentEmail: string; parentPhone: string | null;
};
export type TeacherRow = {
  name: string; collegeId: string; email: string | null; phone: string | null;
  departmentId: string; designation: string | null; roles: Role[]; mentorSectionId: string | null;
};
export type ImportRow<T> = { line: number; raw: Record<string, string>; data: T | null; errors: string[] };

const emailOk = (s: string) => z.email().safeParse(s).success;
const idOk = (s: string) => /^[A-Z0-9-]{3,32}$/.test(s);
const phoneOk = (s: string) => /^\+?[0-9 ()-]{7,20}$/.test(s);

export function missingColumns(headers: string[], required: string[]): string[] {
  return required.filter((c) => !headers.includes(c));
}

/** Marks IDs/emails that already exist in the database or repeat within the file. */
async function duplicates(collegeIds: string[], emails: string[]) {
  const [byId, byEmail] = await Promise.all([
    db.user.findMany({ where: { collegeId: { in: collegeIds } }, select: { collegeId: true } }),
    emails.length ? db.user.findMany({ where: { email: { in: emails } }, select: { email: true } }) : [],
  ]);
  return { ids: new Set(byId.map((u) => u.collegeId)), emails: new Set(byEmail.map((u) => u.email!)) };
}

export async function validateStudents(rows: Record<string, string>[]): Promise<ImportRow<StudentRow>[]> {
  const currentYear = await db.academicYear.findFirst({ where: { isCurrent: true } });
  const [departments, sections] = await Promise.all([
    db.department.findMany(),
    db.section.findMany({ where: { academicYearId: currentYear?.id }, include: { batches: true } }),
  ]);
  const ids = rows.map((r) => (r.college_id ?? "").toUpperCase());
  const emails = rows.map((r) => (r.email ?? "").toLowerCase()).filter(Boolean);
  const existing = await duplicates(ids, emails);
  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();
  const startYear = currentYear ? currentYear.startDate.getUTCFullYear() : new Date().getUTCFullYear();

  return rows.map((raw, i) => {
    const errors: string[] = [];
    const collegeId = (raw.college_id ?? "").toUpperCase();
    const email = (raw.email ?? "").toLowerCase() || null;
    const year = Number(raw.year);

    if (!raw.name || raw.name.length < 2) errors.push("Name is missing");
    if (!idOk(collegeId)) errors.push("College ID must be 3-32 letters, digits or dashes");
    else if (existing.ids.has(collegeId)) errors.push(`College ID ${collegeId} already exists`);
    else if (seenIds.has(collegeId)) errors.push(`College ID ${collegeId} repeats in this file`);
    seenIds.add(collegeId);

    if (email) {
      if (!emailOk(email)) errors.push("Student email is not valid");
      else if (existing.emails.has(email) || seenEmails.has(email)) errors.push(`Email ${email} is already used`);
      seenEmails.add(email);
    }
    if (raw.phone && !phoneOk(raw.phone)) errors.push("Phone is not valid");

    const dept = departments.find((d) => d.code === (raw.department ?? "").toUpperCase());
    if (!dept) errors.push(`Department "${raw.department ?? ""}" not found`);
    if (![1, 2, 3].includes(year)) errors.push("Year must be 1, 2 or 3");

    const section = dept && sections.find((s) => s.departmentId === dept.id && s.year === year && s.name === (raw.section ?? "").toUpperCase());
    if (dept && [1, 2, 3].includes(year) && !section) errors.push(`Section ${year}-${raw.section ?? ""} not found in ${dept.code}`);

    let batchId: string | null = null;
    if (raw.batch && section) {
      const batch = section.batches.find((b) => b.name.toLowerCase() === raw.batch.toLowerCase() || b.name === `Batch ${raw.batch}`);
      if (!batch) errors.push(`Batch "${raw.batch}" not found in that section`);
      else batchId = batch.id;
    }

    const parentEmail = (raw.parent_email ?? "").toLowerCase();
    if (!raw.parent_name) errors.push("Parent name is missing");
    if (!emailOk(parentEmail)) errors.push("Parent email is not valid");
    if (raw.parent_phone && !phoneOk(raw.parent_phone)) errors.push("Parent phone is not valid");

    const admissionYear = raw.admission_year ? Number(raw.admission_year) : startYear - (year - 1);
    if (!Number.isInteger(admissionYear) || admissionYear < 2000 || admissionYear > 2100) errors.push("Admission year is not valid");

    const dateOfBirth = raw.date_of_birth ? parseFlexibleDate(raw.date_of_birth) : null;
    if (raw.date_of_birth && !dateOfBirth) errors.push("Date of birth: use YYYY-MM-DD or DD/MM/YYYY");

    const data: StudentRow | null =
      errors.length === 0 && dept && section
        ? {
            name: raw.name, collegeId, email, phone: raw.phone || null,
            departmentId: dept.id, year, sectionId: section.id, batchId,
            admissionYear, dateOfBirth,
            parentName: raw.parent_name, parentEmail, parentPhone: raw.parent_phone || null,
          }
        : null;
    return { line: i + 2, raw, data, errors };
  });
}

export async function validateTeachers(rows: Record<string, string>[]): Promise<ImportRow<TeacherRow>[]> {
  const currentYear = await db.academicYear.findFirst({ where: { isCurrent: true } });
  const [departments, sections] = await Promise.all([
    db.department.findMany(),
    db.section.findMany({ where: { academicYearId: currentYear?.id } }),
  ]);
  const ids = rows.map((r) => (r.college_id ?? "").toUpperCase());
  const emails = rows.map((r) => (r.email ?? "").toLowerCase()).filter(Boolean);
  const existing = await duplicates(ids, emails);
  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();

  return rows.map((raw, i) => {
    const errors: string[] = [];
    const collegeId = (raw.college_id ?? "").toUpperCase();
    const email = (raw.email ?? "").toLowerCase() || null;

    if (!raw.name || raw.name.length < 2) errors.push("Name is missing");
    if (!idOk(collegeId)) errors.push("College ID must be 3-32 letters, digits or dashes");
    else if (existing.ids.has(collegeId) || seenIds.has(collegeId)) errors.push(`College ID ${collegeId} already exists`);
    seenIds.add(collegeId);
    if (email) {
      if (!emailOk(email)) errors.push("Email is not valid");
      else if (existing.emails.has(email) || seenEmails.has(email)) errors.push(`Email ${email} is already used`);
      seenEmails.add(email);
    } else errors.push("Email is needed so the teacher can receive their activation code");
    if (raw.phone && !phoneOk(raw.phone)) errors.push("Phone is not valid");

    const dept = departments.find((d) => d.code === (raw.department ?? "").toUpperCase());
    if (!dept) errors.push(`Department "${raw.department ?? ""}" not found`);

    const roleNames = (raw.roles || "TEACHER").toUpperCase().split(/[;,|\s]+/).filter(Boolean);
    const roles = [...new Set(["TEACHER", ...roleNames])] as Role[];
    const bad = roles.filter((r) => !["TEACHER", "HOD", "MENTOR"].includes(r));
    if (bad.length) errors.push(`Unknown role(s): ${bad.join(", ")}. Use TEACHER, HOD, MENTOR`);

    let mentorSectionId: string | null = null;
    if (roles.includes("MENTOR")) {
      const m = /^([1-3])\s*-\s*([A-Za-z0-9]+)$/.exec(raw.mentor_section ?? "");
      const section = m && dept && sections.find((s) => s.departmentId === dept.id && s.year === Number(m[1]) && s.name === m[2].toUpperCase());
      if (!section) errors.push('MENTOR needs mentor_section like "1-A" in the same department');
      else mentorSectionId = section.id;
    }

    const data: TeacherRow | null =
      errors.length === 0 && dept
        ? { name: raw.name, collegeId, email, phone: raw.phone || null, departmentId: dept.id, designation: raw.designation || null, roles, mentorSectionId }
        : null;
    return { line: i + 2, raw, data, errors };
  });
}

/** Creates accounts for valid rows. Users activate later with an emailed code. */
export async function commitStudents(rows: StudentRow[]): Promise<{ created: number; skipped: string[] }> {
  const skipped: string[] = [];
  let created = 0;
  for (const r of rows) {
    try {
      await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            collegeId: r.collegeId,
            name: r.name,
            email: r.email,
            phone: r.phone,
            passwordHash: UNUSABLE_PASSWORD,
            mustChangePassword: true,
            roles: { create: [{ role: "STUDENT", departmentId: r.departmentId, year: r.year, sectionId: r.sectionId }] },
            student: {
              create: {
                rollNo: r.collegeId,
                departmentId: r.departmentId,
                sectionId: r.sectionId,
                batchId: r.batchId,
                year: r.year,
                admissionYear: r.admissionYear,
                dateOfBirth: r.dateOfBirth ? new Date(r.dateOfBirth) : null,
              },
            },
          },
          include: { student: true },
        });
        const parent =
          (await tx.parent.findFirst({ where: { email: r.parentEmail } })) ??
          (await tx.parent.create({ data: { name: r.parentName, email: r.parentEmail, phone: r.parentPhone } }));
        await tx.parentStudent.create({ data: { parentId: parent.id, studentId: user.student!.id } });
      });
      created++;
    } catch {
      skipped.push(r.collegeId);
    }
  }
  return { created, skipped };
}

export async function commitTeachers(rows: TeacherRow[]): Promise<{ created: number; skipped: string[] }> {
  const sections = await db.section.findMany();
  const skipped: string[] = [];
  let created = 0;
  for (const r of rows) {
    try {
      await db.$transaction(async (tx) => {
        const mentorSection = sections.find((s) => s.id === r.mentorSectionId);
        const user = await tx.user.create({
          data: {
            collegeId: r.collegeId,
            name: r.name,
            email: r.email,
            phone: r.phone,
            passwordHash: UNUSABLE_PASSWORD,
            mustChangePassword: true,
            roles: {
              create: r.roles.map((role) =>
                role === "MENTOR" && mentorSection
                  ? { role, departmentId: mentorSection.departmentId, year: mentorSection.year, sectionId: mentorSection.id }
                  : { role, departmentId: r.departmentId },
              ),
            },
            teacher: { create: { departmentId: r.departmentId, designation: r.designation } },
          },
          include: { teacher: true },
        });
        if (mentorSection) {
          await tx.student.updateMany({ where: { sectionId: mentorSection.id }, data: { mentorId: user.teacher!.id } });
        }
      });
      created++;
    } catch {
      skipped.push(r.collegeId);
    }
  }
  return { created, skipped };
}
