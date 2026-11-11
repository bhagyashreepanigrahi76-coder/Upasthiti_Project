"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { type ActionState, failure, formValues, fromZodError, success } from "@/lib/action-state";
import { isDateKey } from "@/lib/dates";
import { isUniqueViolation } from "@/lib/db-errors";

// FR-26: academic years, departments, sections, batches, subjects and
// teacher-subject mapping. Admin only; every change is audited.

const dateKey = z.string().refine(isDateKey, "Enter a valid date");
const id = z.string().min(1);

async function currentYearId(): Promise<string | null> {
  const ay = await db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
  return ay?.id ?? null;
}

// --- Academic years ----------------------------------------------------------

const yearSchema = z
  .object({
    name: z.string().regex(/^\d{4}-\d{2}$/, "Use the form 2027-28"),
    startDate: dateKey,
    endDate: dateKey,
  })
  .refine((v) => v.endDate > v.startDate, { path: ["endDate"], message: "End date must be after the start date" });

export async function createAcademicYear(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const parsed = yearSchema.safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  try {
    const year = await db.academicYear.create({
      data: {
        name: parsed.data.name,
        startDate: new Date(parsed.data.startDate),
        endDate: new Date(parsed.data.endDate),
      },
    });
    await logAudit({ actorId: admin.id, action: "ACADEMIC_YEAR_CREATED", entityType: "AcademicYear", entityId: year.id });
  } catch (err) {
    if (isUniqueViolation(err)) return failure(`Academic year ${parsed.data.name} already exists.`);
    throw err;
  }
  refresh();
  return success(`Academic year ${parsed.data.name} added.`);
}

export async function setCurrentAcademicYear(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const yearId = String(formData.get("id") ?? "");
  const year = await db.academicYear.findUnique({ where: { id: yearId } });
  if (!year) return failure("Academic year not found.");
  await db.$transaction([
    db.academicYear.updateMany({ data: { isCurrent: false } }),
    db.academicYear.update({ where: { id: yearId }, data: { isCurrent: true } }),
  ]);
  await logAudit({ actorId: admin.id, action: "ACADEMIC_YEAR_SET_CURRENT", entityType: "AcademicYear", entityId: yearId });
  refresh();
  return success(`${year.name} is now the current academic year.`);
}

// --- Departments -------------------------------------------------------------

const departmentSchema = z.object({
  id: z.string().optional(),
  code: z
    .string()
    .min(2, "At least 2 characters")
    .max(10)
    .regex(/^[A-Za-z0-9]+$/, "Letters and digits only")
    .transform((s) => s.toUpperCase()),
  name: z.string().min(2).max(80),
  programme: z.string().min(2).max(120),
});

export async function saveDepartment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const parsed = departmentSchema.safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { id: deptId, ...data } = parsed.data;
  try {
    const dept = deptId
      ? await db.department.update({ where: { id: deptId }, data })
      : await db.department.create({ data });
    await logAudit({
      actorId: admin.id,
      action: deptId ? "DEPARTMENT_UPDATED" : "DEPARTMENT_CREATED",
      entityType: "Department",
      entityId: dept.id,
      details: data,
    });
  } catch (err) {
    if (isUniqueViolation(err)) return failure(`Department code ${data.code} is already used.`);
    throw err;
  }
  refresh();
  return success(deptId ? "Department updated." : `Department ${data.code} added.`);
}

export async function deleteDepartment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const deptId = String(formData.get("id") ?? "");
  const counts = await db.department.findUnique({
    where: { id: deptId },
    select: { code: true, _count: { select: { sections: true, subjects: true, teachers: true, students: true } } },
  });
  if (!counts) return failure("Department not found.");
  const used = Object.values(counts._count).some((n) => n > 0);
  if (used) return failure("Remove its sections, subjects, teachers and students first.");
  await db.department.delete({ where: { id: deptId } });
  await logAudit({ actorId: admin.id, action: "DEPARTMENT_DELETED", entityType: "Department", entityId: deptId, details: { code: counts.code } });
  refresh();
  return success("Department deleted.");
}

// --- Sections and batches -----------------------------------------------------

const sectionSchema = z.object({
  departmentId: id,
  year: z.coerce.number().int().min(1).max(3),
  name: z
    .string()
    .min(1)
    .max(5)
    .regex(/^[A-Za-z0-9]+$/, "Letters and digits only")
    .transform((s) => s.toUpperCase()),
});

export async function createSection(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const parsed = sectionSchema.safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const academicYearId = await currentYearId();
  if (!academicYearId) return failure("Set a current academic year first.");
  try {
    const section = await db.section.create({ data: { ...parsed.data, academicYearId } });
    await logAudit({ actorId: admin.id, action: "SECTION_CREATED", entityType: "Section", entityId: section.id, details: parsed.data });
  } catch (err) {
    if (isUniqueViolation(err)) return failure("That section already exists for this year.");
    throw err;
  }
  refresh();
  return success(`Section ${parsed.data.year}-${parsed.data.name} added.`);
}

export async function deleteSection(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const sectionId = String(formData.get("id") ?? "");
  const section = await db.section.findUnique({
    where: { id: sectionId },
    select: { _count: { select: { students: true, teacherSubjects: true, timetables: true } } },
  });
  if (!section) return failure("Section not found.");
  if (section._count.students || section._count.teacherSubjects || section._count.timetables) {
    return failure("Move its students and remove its subject mappings and timetables first.");
  }
  await db.section.delete({ where: { id: sectionId } });
  await logAudit({ actorId: admin.id, action: "SECTION_DELETED", entityType: "Section", entityId: sectionId });
  refresh();
  return success("Section deleted.");
}

export async function createBatch(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const parsed = z
    .object({ sectionId: id, name: z.string().min(1, "Enter a batch name").max(30) })
    .safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  try {
    const batch = await db.batch.create({ data: parsed.data });
    await logAudit({ actorId: admin.id, action: "BATCH_CREATED", entityType: "Batch", entityId: batch.id });
  } catch (err) {
    if (isUniqueViolation(err)) return failure("A batch with that name already exists in this section.");
    throw err;
  }
  refresh();
  return success("Batch added.");
}

export async function deleteBatch(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const batchId = String(formData.get("id") ?? "");
  await db.batch.delete({ where: { id: batchId } }).catch(() => null);
  await logAudit({ actorId: admin.id, action: "BATCH_DELETED", entityType: "Batch", entityId: batchId });
  refresh();
  return success("Batch deleted. Its students are now unassigned.");
}

/** Splits a section's students into N batches by roll number (FR-56). */
export async function splitIntoBatches(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const parsed = z
    .object({ sectionId: id, count: z.coerce.number().int().min(2).max(6) })
    .safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { sectionId, count } = parsed.data;

  const students = await db.student.findMany({
    where: { sectionId, status: "ACTIVE" },
    orderBy: { rollNo: "asc" },
    select: { id: true },
  });
  if (students.length < count) return failure("There are fewer students than batches.");

  const batches: { id: string }[] = [];
  for (let i = 1; i <= count; i++) {
    batches.push(
      await db.batch.upsert({
        where: { sectionId_name: { sectionId, name: `Batch ${i}` } },
        create: { sectionId, name: `Batch ${i}` },
        update: {},
      }),
    );
  }
  const size = Math.ceil(students.length / count);
  await db.$transaction(
    students.map((s, idx) =>
      db.student.update({ where: { id: s.id }, data: { batchId: batches[Math.floor(idx / size)].id } }),
    ),
  );
  await logAudit({ actorId: admin.id, action: "SECTION_SPLIT_BATCHES", entityType: "Section", entityId: sectionId, details: { count } });
  refresh();
  return success(`${students.length} students split into ${count} batches.`);
}

// --- Subjects ----------------------------------------------------------------

const subjectSchema = z
  .object({
    id: z.string().optional(),
    code: z
      .string()
      .min(2)
      .max(12)
      .regex(/^[A-Za-z0-9-]+$/, "Letters, digits and dashes only")
      .transform((s) => s.toUpperCase()),
    name: z.string().min(2).max(120),
    departmentId: id,
    year: z.coerce.number().int().min(1).max(3),
    semester: z.coerce.number().int().min(1).max(6),
    credits: z.coerce.number().int().min(0).max(10),
    type: z.enum(["THEORY", "PRACTICAL"]),
  })
  .refine((v) => v.semester === v.year * 2 - 1 || v.semester === v.year * 2, {
    path: ["semester"],
    message: "Year 1 has semesters 1-2, Year 2 has 3-4, Year 3 has 5-6",
  });

export async function saveSubject(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const parsed = subjectSchema.safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { id: subjectId, ...data } = parsed.data;
  try {
    const subject = subjectId
      ? await db.subject.update({ where: { id: subjectId }, data })
      : await db.subject.create({ data });
    await logAudit({
      actorId: admin.id,
      action: subjectId ? "SUBJECT_UPDATED" : "SUBJECT_CREATED",
      entityType: "Subject",
      entityId: subject.id,
      details: data,
    });
  } catch (err) {
    if (isUniqueViolation(err)) return failure(`Subject code ${data.code} is already used.`);
    throw err;
  }
  refresh();
  return success(subjectId ? "Subject updated." : `Subject ${data.code} added.`);
}

export async function deleteSubject(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const subjectId = String(formData.get("id") ?? "");
  const subject = await db.subject.findUnique({
    where: { id: subjectId },
    select: { code: true, _count: { select: { teacherSubjects: true, timetableSlots: true } } },
  });
  if (!subject) return failure("Subject not found.");
  if (subject._count.teacherSubjects || subject._count.timetableSlots) {
    return failure("Remove its teacher mappings and timetable slots first.");
  }
  await db.subject.delete({ where: { id: subjectId } });
  await logAudit({ actorId: admin.id, action: "SUBJECT_DELETED", entityType: "Subject", entityId: subjectId, details: { code: subject.code } });
  refresh();
  return success("Subject deleted.");
}

// --- Teacher-subject mapping ------------------------------------------------

export async function createMapping(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const parsed = z.object({ teacherId: id, subjectId: id, sectionId: id }).safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { teacherId, subjectId, sectionId } = parsed.data;

  const [subject, section] = await Promise.all([
    db.subject.findUnique({ where: { id: subjectId } }),
    db.section.findUnique({ where: { id: sectionId } }),
  ]);
  if (!subject || !section) return failure("Subject or section not found.");
  if (subject.departmentId !== section.departmentId || subject.year !== section.year) {
    return failure(`${subject.code} belongs to a different department or year than this section.`);
  }
  try {
    const m = await db.teacherSubject.create({
      data: { teacherId, subjectId, sectionId, academicYearId: section.academicYearId },
    });
    await logAudit({ actorId: admin.id, action: "TEACHER_SUBJECT_MAPPED", entityType: "TeacherSubject", entityId: m.id, details: parsed.data });
  } catch (err) {
    if (isUniqueViolation(err)) return failure("This teacher already teaches that subject to that section.");
    throw err;
  }
  refresh();
  return success("Mapping added.");
}

export async function deleteMapping(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const mappingId = String(formData.get("id") ?? "");
  await db.teacherSubject.delete({ where: { id: mappingId } }).catch(() => null);
  await logAudit({ actorId: admin.id, action: "TEACHER_SUBJECT_UNMAPPED", entityType: "TeacherSubject", entityId: mappingId });
  refresh();
  return success("Mapping removed.");
}
