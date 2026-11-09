"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { canApproveForStudent, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { notifyUsers } from "@/lib/notify";
import { formatDateKey, parseHHMM, zonedDateTime } from "@/lib/dates";
import { type ActionState, failure, formValues, fromZodError, success } from "@/lib/action-state";

// Decisions on leave (FR-17) and regularisation (FR-11) requests. The
// decider must be the student's class coordinator or HOD; checked here.

const decisionSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(300).optional(),
});

export async function decideLeave(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = decisionSchema.safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { id, decision, note } = parsed.data;
  if (decision === "REJECTED" && !note) return { fieldErrors: { note: "Give a reason for rejecting" }, error: "Add a short reason." };

  const leave = await db.leaveRequest.findUnique({ where: { id }, include: { student: true } });
  if (!leave || !(await canApproveForStudent(user, leave.student))) return failure("You cannot decide this request.");

  const claimed = await db.leaveRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: decision, decidedById: user.id, decidedAt: new Date(), decisionNote: note ?? null },
  });
  if (claimed.count === 0) return failure("This request was already decided or cancelled.");

  await notifyUsers([leave.student.userId], {
    title: `Leave ${decision === "APPROVED" ? "approved" : "rejected"}`,
    body: `${formatDateKey(leave.fromDate)} – ${formatDateKey(leave.toDate)}${note ? ` · ${note}` : ""}`,
    link: "/student/requests",
  });
  await logAudit({ actorId: user.id, action: `LEAVE_${decision}`, entityType: "LeaveRequest", entityId: id, details: { note } });
  refresh();
  return success(`Leave ${decision === "APPROVED" ? "approved" : "rejected"}.`);
}

export async function decideRegularisation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = decisionSchema.safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { id, decision, note } = parsed.data;
  if (decision === "REJECTED" && !note) return { fieldErrors: { note: "Give a reason for rejecting" }, error: "Add a short reason." };

  const req = await db.regularisationRequest.findUnique({ where: { id }, include: { student: true } });
  if (!req || !(await canApproveForStudent(user, req.student))) return failure("You cannot decide this request.");

  const claimed = await db.regularisationRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: decision, decidedById: user.id, decidedAt: new Date(), decisionNote: note ?? null },
  });
  if (claimed.count === 0) return failure("This request was already decided or cancelled.");

  if (decision === "APPROVED") {
    const inAt = zonedDateTime(req.dateKey, req.requestedIn);
    const outAt = zonedDateTime(req.dateKey, req.requestedOut);
    const minutes = parseHHMM(req.requestedOut) - parseHHMM(req.requestedIn);
    const data = { inAt, outAt, minutesOnCampus: minutes, status: "REGULARISED" as const, closedReason: `Regularised by ${user.name}` };
    const existing =
      (req.sessionId && (await db.campusSession.findUnique({ where: { id: req.sessionId } }))) ||
      (await db.campusSession.findFirst({ where: { studentId: req.studentId, dateKey: req.dateKey, status: "INCOMPLETE" } }));
    const session = existing
      ? await db.campusSession.update({ where: { id: existing.id }, data })
      : await db.campusSession.create({ data: { studentId: req.studentId, dateKey: req.dateKey, ...data } });
    await db.regularisationRequest.update({ where: { id }, data: { sessionId: session.id } });
  }

  await notifyUsers([req.student.userId], {
    title: `Regularisation ${decision === "APPROVED" ? "approved" : "rejected"}`,
    body: `${formatDateKey(req.dateKey)}${note ? ` · ${note}` : ""}`,
    link: "/student/requests",
  });
  await logAudit({ actorId: user.id, action: `REGULARISATION_${decision}`, entityType: "RegularisationRequest", entityId: id, details: { note } });
  refresh();
  return success(`Request ${decision === "APPROVED" ? "approved; the campus day is now recorded" : "rejected"}.`);
}
