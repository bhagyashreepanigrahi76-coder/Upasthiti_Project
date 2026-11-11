"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireStudent } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getSettings } from "@/lib/settings";
import { getDayStatus } from "@/lib/calendar";
import { addDays, daysBetweenInclusive, formatDateKey, isDateKey, parseHHMM, toDateKey } from "@/lib/dates";
import { saveUpload, type StoredFile } from "@/lib/uploads";
import { notifyUsers } from "@/lib/notify";
import { approverUserIds } from "@/lib/approvers";
import { type ActionState, failure, formValues, fromZodError, success } from "@/lib/action-state";

const dateKey = z.string().refine(isDateKey, "Enter a valid date");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

// --- Leave (FR-17) ------------------------------------------------------------

const leaveSchema = z
  .object({
    fromDate: dateKey,
    toDate: dateKey,
    type: z.enum(["MEDICAL", "PERSONAL", "FAMILY", "OTHER"]),
    reason: z.string().trim().min(5, "Describe the reason in a few words").max(1000),
  })
  .refine((v) => v.toDate >= v.fromDate, { path: ["toDate"], message: "End date is before the start date" })
  .refine((v) => daysBetweenInclusive(v.fromDate, v.toDate) <= 30, { path: ["toDate"], message: "At most 30 days per request" });

export async function submitLeave(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, student } = await requireStudent();
  const parsed = leaveSchema.safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { fromDate, toDate, type, reason } = parsed.data;

  const today = toDateKey(new Date());
  if (fromDate < addDays(today, -30)) return { fieldErrors: { fromDate: "Requests can go back at most 30 days" }, error: "Date too far in the past." };

  const overlap = await db.leaveRequest.findFirst({
    where: { studentId: student.id, status: { in: ["PENDING", "APPROVED"] }, fromDate: { lte: toDate }, toDate: { gte: fromDate } },
  });
  if (overlap) return failure(`You already have a ${overlap.status.toLowerCase()} leave from ${formatDateKey(overlap.fromDate)} to ${formatDateKey(overlap.toDate)}.`);

  let doc: StoredFile | null = null;
  const file = formData.get("document");
  if (file instanceof File && file.size > 0) {
    try {
      doc = await saveUpload(file, "leave", (await getSettings()).uploadMaxMb);
    } catch (err) {
      return { fieldErrors: { document: (err as Error).message }, error: (err as Error).message };
    }
  }
  if (type === "MEDICAL" && !doc && daysBetweenInclusive(fromDate, toDate) > 2) {
    return { fieldErrors: { document: "Attach a medical certificate for medical leave over 2 days" }, error: "Medical certificate needed." };
  }

  const leave = await db.leaveRequest.create({
    data: {
      studentId: student.id,
      fromDate,
      toDate,
      type,
      reason,
      documentPath: doc?.path,
      documentName: doc?.name,
      documentMime: doc?.mime,
      documentSize: doc?.size,
    },
  });
  await notifyUsers(await approverUserIds(student), {
    title: `Leave request from ${user.name}`,
    body: `${formatDateKey(fromDate)} – ${formatDateKey(toDate)} · ${type.toLowerCase()}`,
    link: "/teacher/approvals",
  });
  await logAudit({ actorId: user.id, action: "LEAVE_REQUESTED", entityType: "LeaveRequest", entityId: leave.id, details: { fromDate, toDate, type } });
  refresh();
  return success("Leave request sent to your class coordinator and HOD.");
}

// --- Regularisation (FR-11) -------------------------------------------------

const regSchema = z
  .object({
    dateKey,
    requestedIn: hhmm,
    requestedOut: hhmm,
    reason: z.enum(["NETWORK", "GPS", "DEVICE", "FORGOT", "OTHER"]),
    details: z.string().trim().min(5, "Explain what happened").max(1000),
  })
  .refine((v) => parseHHMM(v.requestedOut) > parseHHMM(v.requestedIn), { path: ["requestedOut"], message: "Must be after the in time" });

export async function submitRegularisation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, student } = await requireStudent();
  const parsed = regSchema.safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const d = parsed.data;

  const today = toDateKey(new Date());
  if (d.dateKey > today) return { fieldErrors: { dateKey: "Cannot be in the future" }, error: "Choose a past date." };
  if (d.dateKey < addDays(today, -30)) return { fieldErrors: { dateKey: "At most 30 days back" }, error: "Date too far in the past." };

  const day = await getDayStatus(d.dateKey, { departmentId: student.departmentId, year: student.year });
  if (!day.working) return { fieldErrors: { dateKey: `Not a working day (${day.reason})` }, error: "That was not a working day." };

  const sessions = await db.campusSession.findMany({ where: { studentId: student.id, dateKey: d.dateKey } });
  if (sessions.some((s) => s.status === "COMPLETE" || s.status === "REGULARISED")) {
    return failure("Your attendance for that day is already complete.");
  }
  if (sessions.some((s) => s.status === "OPEN")) return failure("You are still punched in for that day. Punch out first.");
  const pending = await db.regularisationRequest.findFirst({ where: { studentId: student.id, dateKey: d.dateKey, status: "PENDING" } });
  if (pending) return failure("You already have a pending request for that day.");

  const req = await db.regularisationRequest.create({
    data: { studentId: student.id, sessionId: sessions[0]?.id, ...d },
  });
  await notifyUsers(await approverUserIds(student), {
    title: `Regularisation request from ${user.name}`,
    body: `${formatDateKey(d.dateKey)} · ${d.requestedIn}–${d.requestedOut}`,
    link: "/teacher/approvals",
  });
  await logAudit({ actorId: user.id, action: "REGULARISATION_REQUESTED", entityType: "RegularisationRequest", entityId: req.id, details: d });
  refresh();
  return success("Regularisation request sent for approval.");
}

export async function cancelRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, student } = await requireStudent();
  const id = String(formData.get("id") ?? "");
  const kind = formData.get("kind");
  // Only the student's own pending requests can be cancelled.
  const where = { id, studentId: student.id, status: "PENDING" as const };
  const result =
    kind === "leave"
      ? await db.leaveRequest.updateMany({ where, data: { status: "CANCELLED" } })
      : await db.regularisationRequest.updateMany({ where, data: { status: "CANCELLED" } });
  if (result.count === 0) return failure("Only pending requests can be cancelled.");
  await logAudit({ actorId: user.id, action: kind === "leave" ? "LEAVE_CANCELLED" : "REGULARISATION_CANCELLED", entityId: id });
  refresh();
  return success("Request cancelled.");
}
