"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { AssessmentKind } from "@prisma/client";
import { departmentsFor, getTeacherProfile, requireUser, type CurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getSettings, saveSettings } from "@/lib/settings";
import { readTable } from "@/lib/spreadsheet";
import { isDateKey, zonedDateTime } from "@/lib/dates";
import { formatDateTime } from "@/lib/config";
import { notifyUsers } from "@/lib/notify";
import { KIND_LABEL, KIND_ORDER, notifyResultPublished, parseMark, schemeFor } from "@/lib/results";
import { type ActionState, failure, formValues, success } from "@/lib/action-state";


/** The teacher's own subject-section mapping and the assessment for a kind (FR-20, FR-21). */
async function teacherAssessment(user: CurrentUser, mappingId: string, kind: string) {
  const teacher = await getTeacherProfile(user.id);
  const mapping = await db.teacherSubject.findUnique({ where: { id: mappingId }, include: { subject: true, section: true } });
  if (!teacher || !mapping || mapping.teacherId !== teacher.id) return { error: "You can only enter marks for your own subjects." } as const;
  const settings = await getSettings();
  const item = schemeFor(mapping.subject.type, settings).find((i) => i.kind === kind);
  if (!item) return { error: "That assessment is not part of this subject's scheme." } as const;
  const assessment = await db.assessment.findUnique({
    where: {
      subjectId_sectionId_academicYearId_kind: {
        subjectId: mapping.subjectId,
        sectionId: mapping.sectionId,
        academicYearId: mapping.academicYearId,
        kind: kind as AssessmentKind,
      },
    },
  });
  return { mapping, item, assessment, settings } as const;
}

async function canVerify(user: CurrentUser, assessmentId: string) {
  const a = await db.assessment.findUnique({ where: { id: assessmentId }, include: { section: true, subject: true } });
  if (!a) return null;
  const ok = user.roles.includes("ADMIN") || departmentsFor(user, "HOD").includes(a.section.departmentId);
  return ok ? a : null;
}

async function notifyTeachersOf(subjectId: string, sectionId: string, title: string, body?: string) {
  const mappings = await db.teacherSubject.findMany({ where: { subjectId, sectionId }, include: { teacher: true } });
  await notifyUsers(mappings.map((m) => m.teacher.userId), { title, body, link: "/teacher/marks" });
}

/** Saves draft marks; with intent=submit also sends them for verification (FR-22, FR-23). */
export async function saveMarks(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const v = formValues(formData);
  const ctx = await teacherAssessment(user, v.mappingId ?? "", v.kind ?? "");
  if ("error" in ctx) return failure(ctx.error ?? "Not allowed.");
  const { mapping, item, assessment } = ctx;
  if (assessment && assessment.status !== "DRAFT") return failure("These marks are already submitted and can no longer be edited here.");

  let raw: Record<string, string>;
  try {
    raw = z.record(z.string(), z.string().max(10)).parse(JSON.parse(v.entries ?? "{}"));
  } catch {
    return failure("The marks data was not valid. Reload the page.");
  }
  const roster = await db.student.findMany({ where: { sectionId: mapping.sectionId, status: "ACTIVE" }, orderBy: { rollNo: "asc" } });
  const errors: string[] = [];
  const parsed = roster.map((s) => {
    const r = parseMark(raw[s.id] ?? "", item.maxMarks);
    if (!r.ok) errors.push(`${s.rollNo}: ${r.error}`);
    return { student: s, r };
  });
  if (errors.length) return { error: `Not saved:\n• ${errors.slice(0, 10).join("\n• ")}` };

  const submit = v.intent === "submit";
  const blanks = parsed.filter((p) => p.r.ok && p.r.empty).length;
  if (submit && blanks) return failure(`Enter marks or AB for every student before submitting (${blanks} blank).`);

  const a =
    assessment ??
    (await db.assessment.create({
      data: {
        subjectId: mapping.subjectId,
        sectionId: mapping.sectionId,
        academicYearId: mapping.academicYearId,
        kind: item.kind,
        maxMarks: item.maxMarks,
        weightage: item.weightage,
      },
    }));
  await db.$transaction([
    ...parsed
      .filter((p) => p.r.ok && !p.r.empty)
      .map((p) => {
        const r = p.r as { marks: number | null; absent: boolean };
        return db.markEntry.upsert({
          where: { assessmentId_studentId: { assessmentId: a.id, studentId: p.student.id } },
          create: { assessmentId: a.id, studentId: p.student.id, marks: r.marks, absent: r.absent, updatedById: user.id },
          update: { marks: r.marks, absent: r.absent, updatedById: user.id },
        });
      }),
    db.markEntry.deleteMany({ where: { assessmentId: a.id, studentId: { in: parsed.filter((p) => p.r.ok && p.r.empty).map((p) => p.student.id) } } }),
  ]);

  if (submit) {
    await db.assessment.update({ where: { id: a.id }, data: { status: "SUBMITTED", submittedById: user.id, submittedAt: new Date(), returnNote: null } });
    const hods = await db.userRole.findMany({ where: { role: "HOD", departmentId: mapping.section.departmentId }, select: { userId: true } });
    await notifyUsers(hods.map((h) => h.userId), {
      title: `Marks submitted: ${mapping.subject.code} ${KIND_LABEL[item.kind]}`,
      body: `Year ${mapping.section.year}-${mapping.section.name}, from ${user.name}`,
      link: "/hod/marks",
    });
    await logAudit({ actorId: user.id, action: "MARKS_SUBMITTED", entityType: "Assessment", entityId: a.id });
    refresh();
    return success("Marks submitted for verification. You can no longer change them unless the HOD sends them back.");
  }
  await logAudit({ actorId: user.id, action: "MARKS_SAVED", entityType: "Assessment", entityId: a.id, details: { entered: roster.length - blanks } });
  refresh();
  return success(`Draft saved (${roster.length - blanks} of ${roster.length} entered).`);
}

/** FR-22: upload marks from CSV/Excel with columns college_id and marks. */
export async function uploadMarks(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const v = formValues(formData);
  const ctx = await teacherAssessment(user, v.mappingId ?? "", v.kind ?? "");
  if ("error" in ctx) return failure(ctx.error ?? "Not allowed.");
  const { mapping, item, assessment } = ctx;
  if (assessment && assessment.status !== "DRAFT") return failure("These marks are already submitted.");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return failure("Choose a CSV or Excel file.");
  if (file.size > 1024 * 1024) return failure("The file is larger than 1 MB.");
  let table;
  try {
    table = await readTable(file);
  } catch (err) {
    return failure(err instanceof Error ? err.message : "The file could not be read.");
  }
  const idCol = table.headers.includes("college_id") ? "college_id" : table.headers.includes("roll_no") ? "roll_no" : null;
  if (!idCol || !table.headers.includes("marks")) return failure("The file needs the columns college_id (or roll_no) and marks.");

  const roster = await db.student.findMany({ where: { sectionId: mapping.sectionId, status: "ACTIVE" } });
  const errors: string[] = [];
  const rows: { studentId: string; marks: number | null; absent: boolean }[] = [];
  table.rows.forEach((r, i) => {
    const s = roster.find((x) => x.rollNo === (r[idCol] ?? "").toUpperCase());
    if (!s) return errors.push(`Line ${i + 2}: ${r[idCol]} is not in this class`);
    const m = parseMark(r.marks ?? "", item.maxMarks);
    if (!m.ok) return errors.push(`Line ${i + 2}: ${m.error}`);
    if (!m.empty) rows.push({ studentId: s.id, marks: m.marks, absent: m.absent });
  });
  if (errors.length) return { error: `Nothing imported:\n• ${errors.slice(0, 10).join("\n• ")}` };

  const a =
    assessment ??
    (await db.assessment.create({
      data: { subjectId: mapping.subjectId, sectionId: mapping.sectionId, academicYearId: mapping.academicYearId, kind: item.kind, maxMarks: item.maxMarks, weightage: item.weightage },
    }));
  await db.$transaction(
    rows.map((r) =>
      db.markEntry.upsert({
        where: { assessmentId_studentId: { assessmentId: a.id, studentId: r.studentId } },
        create: { assessmentId: a.id, studentId: r.studentId, marks: r.marks, absent: r.absent, updatedById: user.id },
        update: { marks: r.marks, absent: r.absent, updatedById: user.id },
      }),
    ),
  );
  await logAudit({ actorId: user.id, action: "MARKS_UPLOADED", entityType: "Assessment", entityId: a.id, details: { rows: rows.length, file: file.name } });
  refresh();
  return success(`Imported ${rows.length} mark${rows.length === 1 ? "" : "s"} into the draft. Check them, then submit.`);
}

/** HOD/Admin: verify submitted marks, or send them back with a note. */
export async function verifyMarks(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const v = formValues(formData);
  const a = await canVerify(user, v.id ?? "");
  if (!a) return failure("Only the HOD of this department or an admin can verify these marks.");
  if (a.status !== "SUBMITTED") return failure("Only submitted marks can be verified or returned.");
  const what = `${a.subject.code} ${KIND_LABEL[a.kind]}`;
  if (v.intent === "return") {
    if (!v.note) return { error: "Say what needs correcting.", fieldErrors: { note: "Required when sending back" } };
    await db.assessment.update({ where: { id: a.id }, data: { status: "DRAFT", returnNote: v.note } });
    await notifyTeachersOf(a.subjectId, a.sectionId, `Marks returned for correction: ${what}`, v.note);
    await logAudit({ actorId: user.id, action: "MARKS_RETURNED", entityType: "Assessment", entityId: a.id, details: { note: v.note } });
    refresh();
    return success("Sent back to the teacher.");
  }
  await db.assessment.update({ where: { id: a.id }, data: { status: "VERIFIED", verifiedById: user.id, verifiedAt: new Date() } });
  await logAudit({ actorId: user.id, action: "MARKS_VERIFIED", entityType: "Assessment", entityId: a.id });
  refresh();
  return success("Marks verified. The admin can now lock and schedule them.");
}

/** Admin: lock verified marks; then schedule, publish now, or unpublish (FR-23, FR-24). */
export async function manageResult(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!user.roles.includes("ADMIN")) return failure("Admin only.");
  const v = formValues(formData);
  const a = await db.assessment.findUnique({ where: { id: v.id ?? "" }, include: { subject: true } });
  if (!a) return failure("Assessment not found.");
  const what = `${a.subject.code} ${KIND_LABEL[a.kind]}`;
  const now = new Date();

  switch (v.intent) {
    case "lock":
      if (a.status !== "VERIFIED") return failure("Only verified marks can be locked.");
      await db.assessment.update({ where: { id: a.id }, data: { status: "LOCKED", lockedById: user.id, lockedAt: now } });
      await logAudit({ actorId: user.id, action: "MARKS_LOCKED", entityType: "Assessment", entityId: a.id });
      break;
    case "schedule": {
      if (a.status !== "LOCKED") return failure("Lock the marks before scheduling.");
      if (!isDateKey(v.date) || !/^\d{2}:\d{2}$/.test(v.time ?? "")) return { error: "Choose a date and time.", fieldErrors: { date: "Required" } };
      const at = zonedDateTime(v.date, v.time!);
      if (at <= now) return failure("Choose a time in the future, or use Publish now.");
      await db.assessment.update({ where: { id: a.id }, data: { publishAt: at, notifiedAt: null } });
      await logAudit({ actorId: user.id, action: "RESULT_SCHEDULED", entityType: "Assessment", entityId: a.id, details: { publishAt: at.toISOString() } });
      refresh();
      return success(`${what} will be visible to students from ${formatDateTime(at)}.`);
    }
    case "publish":
      if (a.status !== "LOCKED") return failure("Lock the marks before publishing.");
      await db.assessment.update({ where: { id: a.id }, data: { status: "PUBLISHED", publishAt: a.publishAt && a.publishAt < now ? a.publishAt : now, publishedAt: now, notifiedAt: now } });
      await notifyResultPublished(a.sectionId, what);
      await logAudit({ actorId: user.id, action: "RESULT_PUBLISHED", entityType: "Assessment", entityId: a.id });
      break;
    case "unpublish":
      if (a.status !== "PUBLISHED" && !(a.status === "LOCKED" && a.publishAt)) return failure("Nothing to unpublish.");
      await db.assessment.update({ where: { id: a.id }, data: { status: "LOCKED", publishAt: null, publishedAt: null, notifiedAt: null } });
      await logAudit({ actorId: user.id, action: "RESULT_UNPUBLISHED", entityType: "Assessment", entityId: a.id });
      break;
    default:
      return failure("Unknown action.");
  }
  refresh();
  return success({ lock: "Marks locked.", publish: `${what} published. Students and parents were notified.`, unpublish: "Result hidden from students." }[v.intent!]!);
}

/** FR-23: change a locked mark through a logged revision (HOD of the department or admin). */
export async function reviseMark(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const v = formValues(formData);
  const a = await canVerify(user, v.id ?? "");
  if (!a) return failure("Only the HOD of this department or an admin can revise marks.");
  if (a.status !== "LOCKED" && a.status !== "PUBLISHED") return failure("Only locked marks are revised this way. Earlier stages are edited directly.");
  if (!v.reason || v.reason.length < 5) return { error: "Give the reason for the revision.", fieldErrors: { reason: "Required" } };
  const m = parseMark(v.value ?? "", a.maxMarks);
  if (!m.ok || m.empty) return { error: m.ok ? "Enter the corrected mark or AB." : m.error, fieldErrors: { value: "Invalid mark" } };
  const student = await db.student.findFirst({ where: { id: v.studentId ?? "", sectionId: a.sectionId } });
  if (!student) return failure("Choose a student from this class.");
  const old = await db.markEntry.findUnique({ where: { assessmentId_studentId: { assessmentId: a.id, studentId: student.id } } });

  await db.$transaction([
    db.markRevision.create({
      data: {
        assessmentId: a.id,
        studentId: student.id,
        oldMarks: old?.marks ?? null,
        oldAbsent: old?.absent ?? false,
        newMarks: m.marks,
        newAbsent: m.absent,
        reason: v.reason,
        revisedById: user.id,
      },
    }),
    db.markEntry.upsert({
      where: { assessmentId_studentId: { assessmentId: a.id, studentId: student.id } },
      create: { assessmentId: a.id, studentId: student.id, marks: m.marks, absent: m.absent, updatedById: user.id },
      update: { marks: m.marks, absent: m.absent, updatedById: user.id },
    }),
  ]);
  if (a.status === "PUBLISHED") {
    await notifyUsers([student.userId], { title: `Result revised: ${a.subject.code} ${KIND_LABEL[a.kind]}`, body: v.reason, link: "/student/results" });
  }
  await logAudit({ actorId: user.id, action: "MARK_REVISED", entityType: "Assessment", entityId: a.id, details: { studentId: student.id, old: old ? { marks: old.marks, absent: old.absent } : null, new: { marks: m.marks, absent: m.absent }, reason: v.reason } });
  refresh();
  return success("Mark revised and logged.");
}

/** Admin: assessment scheme, pass mark, grade scale (FR-21, FR-27). */
export async function saveResultSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!user.roles.includes("ADMIN")) return failure("Admin only.");
  const v = formValues(formData);
  const scheme = { THEORY: [] as { kind: AssessmentKind; maxMarks: number; weightage: number }[], PRACTICAL: [] as { kind: AssessmentKind; maxMarks: number; weightage: number }[] };
  for (const type of ["THEORY", "PRACTICAL"] as const) {
    for (const kind of KIND_ORDER) {
      const max = Number(v[`${type}.${kind}.max`] ?? 0);
      const weight = Number(v[`${type}.${kind}.weight`] ?? 0);
      if (!weight) continue;
      if (!Number.isInteger(max) || max < 1 || max > 200 || !Number.isInteger(weight) || weight < 1 || weight > 100) {
        return failure(`${type.toLowerCase()} ${KIND_LABEL[kind]}: max marks 1-200 and weightage 1-100.`);
      }
      scheme[type].push({ kind, maxMarks: max, weightage: weight });
    }
    const total = scheme[type].reduce((s, i) => s + i.weightage, 0);
    if (total !== 100) return failure(`${type === "THEORY" ? "Theory" : "Practical"} weightages add up to ${total}; they must total 100.`);
    if (!scheme[type].some((i) => i.kind === "SEMESTER")) return failure("Each scheme needs a semester exam.");
  }
  const scale: { grade: string; minPercent: number; points: number }[] = [];
  for (const line of (v.gradeScale ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const m = /^(\S{1,3})\s+(\d{1,3}(?:\.\d+)?)\s+(\d{1,2}(?:\.\d+)?)$/.exec(line);
    if (!m) return failure(`Grade line "${line}" should look like: A+ 80 9`);
    scale.push({ grade: m[1], minPercent: Number(m[2]), points: Number(m[3]) });
  }
  if (!scale.some((g) => g.minPercent === 0)) return failure("The grade scale needs a grade starting at 0 (e.g. F 0 0).");
  const passPercent = Number(v.passPercent);
  if (!Number.isInteger(passPercent) || passPercent < 1 || passPercent > 100) return failure("Pass mark must be 1-100%.");

  await saveSettings({ assessmentScheme: scheme, gradeScale: scale, passPercent, showGpa: formData.get("showGpa") === "on" });
  await logAudit({ actorId: user.id, action: "RESULT_SETTINGS_UPDATED", details: { scheme, scale, passPercent } });
  refresh();
  return success("Result settings saved. New assessments use this scheme; existing ones keep their max marks and weightage.");
}
