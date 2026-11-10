"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { AttendanceStatus } from "@prisma/client";
import { departmentsFor, getTeacherProfile, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getSettings } from "@/lib/settings";
import { findPeriod, rosterFor } from "@/lib/class-attendance";
import { formatDateKey, isDateKey, minutesOfDay, parseHHMM, toDateKey } from "@/lib/dates";
import { notifyUsers } from "@/lib/notify";
import { type ActionState, failure, formValues, fromZodError, success } from "@/lib/action-state";

const STATUSES = ["PRESENT", "ABSENT", "LATE", "ON_LEAVE", "MEDICAL"] as const;
type Change = { studentId: string; from: AttendanceStatus | null; to: AttendanceStatus };

/** FR-61 / FR-20: mark or edit attendance for a period the teacher takes. */
export async function saveAttendance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = z
    .object({
      dateKey: z.string().refine(isDateKey),
      periodKey: z.string().min(1).max(60),
      entries: z.string(),
      reason: z.string().trim().max(300).optional(),
    })
    .safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { dateKey, periodKey, reason } = parsed.data;

  let entries: Record<string, AttendanceStatus>;
  try {
    entries = z.record(z.string(), z.enum(STATUSES)).parse(JSON.parse(parsed.data.entries));
  } catch {
    return failure("The attendance data was not valid. Reload the page and try again.");
  }

  const found = await findPeriod(dateKey, periodKey);
  if (!found) return failure("That period is not on the timetable for this date, or it was cancelled.");
  const { sectionId, period } = found;

  // Teachers mark only the periods they take (FR-20, §6).
  const teacher = await getTeacherProfile(user.id);
  if (!teacher || teacher.id !== period.teacherId) return failure("Only the teacher taking this period can mark its attendance.");

  const now = new Date();
  const today = toDateKey(now);
  if (dateKey > today || (dateKey === today && minutesOfDay(now) < parseHHMM(period.start) - 10)) {
    return failure("Attendance can be marked from 10 minutes before the period starts.");
  }

  const roster = await rosterFor(sectionId, period.batchId);
  const missing = roster.filter((s) => !entries[s.id]);
  if (missing.length) return failure(`Choose a status for every student (${missing.length} left).`);
  const extra = Object.keys(entries).filter((id) => !roster.some((s) => s.id === id));
  if (extra.length) return failure("The list includes students who are not in this class. Reload the page.");

  const settings = await getSettings();
  const existing = await db.classSession.findUnique({
    where: { dateKey_periodKey: { dateKey, periodKey } },
    include: { records: true, editRequests: { where: { status: "PENDING" } } },
  });

  if (!existing) {
    const session = await db.classSession.create({
      data: {
        dateKey,
        periodKey,
        sectionId,
        subjectId: period.subjectId,
        batchId: period.batchId,
        periodNumber: period.periodNumber,
        span: period.span,
        teacherId: teacher.id,
        takenById: user.id,
        records: { create: roster.map((s) => ({ studentId: s.id, status: entries[s.id], markedById: user.id })) },
      },
    });
    const absent = roster.filter((s) => entries[s.id] === "ABSENT").length;
    await logAudit({ actorId: user.id, action: "ATTENDANCE_TAKEN", entityType: "ClassSession", entityId: session.id, details: { dateKey, periodKey, students: roster.length, absent } });
    refresh();
    return success(`Attendance saved: ${roster.length - absent} present or excused, ${absent} absent.`);
  }

  const changes: Change[] = roster
    .map((s) => ({ studentId: s.id, from: existing.records.find((r) => r.studentId === s.id)?.status ?? null, to: entries[s.id] }))
    .filter((c) => c.from !== c.to);
  if (changes.length === 0) return success("No changes to save.");

  const windowMs = settings.attendanceEditHours * 3_600_000;
  if (now.getTime() - existing.takenAt.getTime() <= windowMs) {
    await db.$transaction(
      changes.map((c) =>
        db.attendanceRecord.upsert({
          where: { classSessionId_studentId: { classSessionId: existing.id, studentId: c.studentId } },
          create: { classSessionId: existing.id, studentId: c.studentId, status: c.to, markedById: user.id },
          update: { status: c.to, markedById: user.id },
        }),
      ),
    );
    await logAudit({ actorId: user.id, action: "ATTENDANCE_EDITED", entityType: "ClassSession", entityId: existing.id, details: { changes } });
    refresh();
    return success(`${changes.length} change${changes.length > 1 ? "s" : ""} saved.`);
  }

  // After the edit window: the HOD must approve (FR-20).
  if (existing.editRequests.length) return failure("An edit request for this period is already waiting for the HOD.");
  if (!reason || reason.length < 5) {
    return { error: `This attendance is older than ${settings.attendanceEditHours} hours. Give a reason; the HOD must approve the change.`, fieldErrors: { reason: "Explain why the change is needed" } };
  }
  const request = await db.attendanceEditRequest.create({
    data: { classSessionId: existing.id, requestedById: user.id, changes: JSON.stringify(changes), reason },
  });
  const section = await db.section.findUnique({ where: { id: sectionId } });
  const hods = await db.userRole.findMany({ where: { role: "HOD", departmentId: section?.departmentId }, select: { userId: true } });
  await notifyUsers(hods.map((h) => h.userId), {
    title: `Attendance edit request from ${user.name}`,
    body: `${formatDateKey(dateKey)}, period ${period.periodNumber}: ${changes.length} change(s)`,
    link: "/hod/attendance-edits",
  });
  await logAudit({ actorId: user.id, action: "ATTENDANCE_EDIT_REQUESTED", entityType: "AttendanceEditRequest", entityId: request.id, details: { changes, reason } });
  refresh();
  return success("The change was sent to the HOD for approval. Attendance stays as it was until then.");
}

/** HOD (or admin) approves or rejects a late attendance edit. */
export async function decideAttendanceEdit(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = z
    .object({ id: z.string().min(1), decision: z.enum(["APPROVED", "REJECTED"]), note: z.string().trim().max(300).optional() })
    .safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { id, decision, note } = parsed.data;
  if (decision === "REJECTED" && !note) return { error: "Add a short reason.", fieldErrors: { note: "Give a reason for rejecting" } };

  const req = await db.attendanceEditRequest.findUnique({ where: { id }, include: { session: { include: { section: true } } } });
  if (!req) return failure("Request not found.");
  const allowed = user.roles.includes("ADMIN") || departmentsFor(user, "HOD").includes(req.session.section.departmentId);
  if (!allowed) return failure("Only the HOD of this department can decide.");

  const claimed = await db.attendanceEditRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: decision, decidedById: user.id, decidedAt: new Date(), decisionNote: note ?? null },
  });
  if (claimed.count === 0) return failure("This request was already decided.");

  if (decision === "APPROVED") {
    const changes = JSON.parse(req.changes) as Change[];
    await db.$transaction(
      changes.map((c) =>
        db.attendanceRecord.upsert({
          where: { classSessionId_studentId: { classSessionId: req.classSessionId, studentId: c.studentId } },
          create: { classSessionId: req.classSessionId, studentId: c.studentId, status: c.to, markedById: req.requestedById },
          update: { status: c.to, markedById: req.requestedById },
        }),
      ),
    );
  }
  await notifyUsers([req.requestedById], {
    title: `Attendance edit ${decision === "APPROVED" ? "approved" : "rejected"}`,
    body: `${formatDateKey(req.session.dateKey)}, period ${req.session.periodNumber}${note ? ` · ${note}` : ""}`,
    link: "/teacher/attendance",
  });
  await logAudit({ actorId: user.id, action: `ATTENDANCE_EDIT_${decision}`, entityType: "AttendanceEditRequest", entityId: id, details: { note } });
  refresh();
  return success(`Edit ${decision === "APPROVED" ? "approved and applied" : "rejected"}.`);
}
