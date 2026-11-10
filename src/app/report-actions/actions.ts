"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { saveSettings } from "@/lib/settings";
import { isMonthKey, formatMonthKey } from "@/lib/dates";
import { generateMonthlyReports } from "@/lib/reports";
import { completeFinishedRuns, processEmailQueue, resendEmail } from "@/lib/email-queue";
import { type ActionState, failure, formValues, fromZodError, success } from "@/lib/action-state";

// Admin controls for parent reports (FR-39): settings, manual trigger,
// pause / resume / cancel a run, send now, resend.

export async function saveReportSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const parsed = z.object({ reportDayOfMonth: z.coerce.number().int().min(1, "1-28").max(28, "1-28") }).safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const values = {
    reportDayOfMonth: parsed.data.reportDayOfMonth,
    reportsPaused: formData.get("reportsPaused") === "on",
    copyCoordinatorOnCritical: formData.get("copyCoordinatorOnCritical") === "on",
    smsOnCritical: formData.get("smsOnCritical") === "on",
  };
  await saveSettings(values);
  await logAudit({ actorId: admin.id, action: "SETTINGS_UPDATED", details: values });
  refresh();
  return success("Report settings saved.");
}

export async function generateReportsNow(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const monthKey = String(formData.get("monthKey") ?? "");
  if (!isMonthKey(monthKey)) return { error: "Choose a month.", fieldErrors: { monthKey: "Choose a month" } };
  const r = await generateMonthlyReports(monthKey, "MANUAL", admin.id);
  refresh();
  return success(
    `${formatMonthKey(monthKey)}: ${r.students} student reports, ${r.emails} emails queued (${r.warnings} warnings, ${r.critical} critical). They go out with the next send.`,
  );
}

export async function setRunStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const to = formData.get("to");
  if (to !== "PAUSED" && to !== "SENDING" && to !== "CANCELLED") return failure("Unknown action.");
  const run = await db.reportRun.findUnique({ where: { id } });
  if (!run || run.status === "CANCELLED" || run.status === "COMPLETED") return failure("This run can no longer be changed.");
  await db.reportRun.update({ where: { id }, data: { status: to } });
  if (to === "CANCELLED") await db.emailLog.updateMany({ where: { runId: id, status: "QUEUED" }, data: { status: "CANCELLED" } });
  await logAudit({ actorId: admin.id, action: `REPORT_RUN_${to}`, entityType: "ReportRun", entityId: id });
  refresh();
  return success({ PAUSED: "Run paused. Its queued emails wait until you resume.", SENDING: "Run resumed.", CANCELLED: "Run cancelled. Unsent emails were cancelled." }[to]);
}

export async function sendQueueNow(): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const r = await processEmailQueue();
  await completeFinishedRuns();
  await logAudit({ actorId: admin.id, action: "EMAIL_QUEUE_PROCESSED", details: r });
  refresh();
  return success(`Sent ${r.sent}, bounced ${r.bounced}, failed ${r.failed}. Temporary failures retry automatically.`);
}

export async function resend(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  if (!(await resendEmail(id))) return failure("Email not found.");
  await logAudit({ actorId: admin.id, action: "EMAIL_RESENT", entityType: "EmailLog", entityId: id });
  refresh();
  return success("Queued again.");
}

/** FR-40: parent unsubscribe page (no sign-in; the link carries a secret token). */
export async function setParentSubscription(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");
  const subscribe = formData.get("subscribe") === "yes";
  if (!/^[a-z0-9]{20,40}$/i.test(token)) return failure("This link is not valid.");
  const parent = await db.parent.findUnique({ where: { unsubscribeToken: token } });
  if (!parent) return failure("This link is not valid.");
  await db.parent.update({ where: { id: parent.id }, data: { unsubscribedNonCritical: !subscribe } });
  await db.auditLog.create({ data: { action: subscribe ? "PARENT_RESUBSCRIBED" : "PARENT_UNSUBSCRIBED", entityType: "Parent", entityId: parent.id } });
  refresh();
  return success(subscribe ? "Monthly reports will be emailed again." : "You will no longer receive monthly reports. Critical attendance alerts will still be sent.");
}
