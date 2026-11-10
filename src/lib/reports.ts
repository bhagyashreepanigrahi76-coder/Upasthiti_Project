import "server-only";
import { db } from "./db";
import { getSettings, type AppSettings } from "./settings";
import { attendanceFor, riskLevel, type Risk } from "./attendance";
import { formatMonthKey, shiftMonth, toDateKey, minutesOfDay } from "./dates";
import { enqueueEmails, type QueuedEmail } from "./email-queue";
import { notifyUsers } from "./notify";
import { sendSms } from "./mailer";
import { logAudit } from "./audit";
import { APP_NAME, COLLEGE_NAME } from "./config";

// Monthly parent reports and low-attendance alerts (PRD §4.8, FR-36..41).

export type MonthlyReport = {
  studentId: string;
  name: string;
  rollNo: string;
  className: string;
  monthKey: string;
  workingDays: number;
  daysPresent: number;
  percent: number | null; // this month
  yearPercent: number | null; // this academic year so far: drives the warning ladder
  risk: Risk;
  subjects: { code: string; name: string; held: number; attended: number; percent: number | null }[];
};

const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const lastDayOf = (monthKey: string) => {
  const [y, m] = monthKey.split("-").map(Number);
  return `${monthKey}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

/** FR-37 content for each active student who had classes that month. */
export async function buildMonthlyReports(monthKey: string, studentIds?: string[]): Promise<MonthlyReport[]> {
  const settings = await getSettings();
  const ay = await db.academicYear.findFirst({ where: { isCurrent: true } });
  const students = await db.student.findMany({
    where: { status: "ACTIVE", ...(studentIds ? { id: { in: studentIds } } : {}) },
    include: { user: { select: { name: true } }, section: true, department: true },
    orderBy: { rollNo: "asc" },
  });
  const ids = students.map((s) => s.id);
  const to = lastDayOf(monthKey);
  const [month, year] = await Promise.all([
    attendanceFor(ids, { from: `${monthKey}-01`, to }),
    attendanceFor(ids, { from: ay?.startDate.toISOString().slice(0, 10), to }),
  ]);
  return students
    .map((s) => {
      const m = month.get(s.id)!;
      const y = year.get(s.id)!;
      const days = [...m.byDate.values()];
      return {
        studentId: s.id,
        name: s.user.name,
        rollNo: s.rollNo,
        className: `${s.department.programme}, Year ${s.year}-${s.section.name}`,
        monthKey,
        workingDays: days.filter((t) => t.held > 0).length,
        daysPresent: days.filter((t) => t.attended > 0).length,
        percent: m.overall.percent,
        yearPercent: y.overall.percent,
        risk: riskLevel(y.overall.percent, settings),
        subjects: m.bySubject.map((x) => ({ code: x.code, name: x.name, held: x.held, attended: x.attended, percent: x.percent })),
      };
    })
    .filter((r) => r.workingDays > 0);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (p: number | null) => (p === null ? "–" : `${p}%`);
const COLOURS: Record<Risk, { bg: string; label: string }> = {
  OK: { bg: "#047857", label: "Good standing" },
  WARNING: { bg: "#b45309", label: "Attendance warning" },
  CRITICAL: { bg: "#b91c1c", label: "Critical: very low attendance" },
  NONE: { bg: "#475569", label: "No classes recorded" },
};

/** Email subject, plain text and HTML for one report (FR-37, FR-38). */
export function renderReport(r: MonthlyReport, settings: AppSettings, opts: { unsubscribeUrl?: string; forCoordinator?: boolean } = {}) {
  const month = formatMonthKey(r.monthKey);
  const c = COLOURS[r.risk];
  const subject =
    r.risk === "CRITICAL"
      ? `URGENT: Low attendance – ${r.name} (${pct(r.yearPercent)})`
      : r.risk === "WARNING"
        ? `Attendance warning – ${r.name}, ${month}`
        : `Monthly attendance report – ${r.name}, ${month}`;
  const advice =
    r.risk === "CRITICAL"
      ? `Attendance this year is ${pct(r.yearPercent)}, below the critical level of ${settings.criticalThreshold}%. Please contact the class coordinator as soon as possible.`
      : r.risk === "WARNING"
        ? `Attendance this year is ${pct(r.yearPercent)}, below the required ${settings.warningThreshold}%. Regular attendance is needed to be eligible for exams.`
        : `Attendance this year is ${pct(r.yearPercent)}. Thank you for your support.`;
  const lines = r.subjects.map((s) => `  ${s.code} ${s.name}: ${s.attended}/${s.held} (${pct(s.percent)})`).join("\n");
  const footer = opts.forCoordinator
    ? "You receive this copy as the class coordinator."
    : r.risk === "CRITICAL"
      ? "Critical attendance alerts are always sent."
      : opts.unsubscribeUrl
        ? `To stop monthly reports (critical alerts will still be sent): ${opts.unsubscribeUrl}`
        : "";

  const text = `${COLLEGE_NAME}\n${c.label}\n\nStudent: ${r.name} (${r.rollNo})\nClass: ${r.className}\nMonth: ${month}\n\nWorking days: ${r.workingDays}\nDays present: ${r.daysPresent}\nAttendance this month: ${pct(r.percent)}\nAttendance this year: ${pct(r.yearPercent)}\n\nBy subject:\n${lines}\n\n${advice}\n\n${footer}\n`;

  const rows = r.subjects
    .map(
      (s) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0">${esc(s.code)} ${esc(s.name)}</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right">${s.attended}/${s.held}</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right">${esc(pct(s.percent))}</td></tr>`,
    )
    .join("");
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#1c2230">
<div style="max-width:560px;margin:0 auto;padding:16px">
<p style="font-size:13px;color:#475569;margin:0 0 8px">${esc(COLLEGE_NAME)} · ${esc(APP_NAME)}</p>
<div style="background:${c.bg};color:#fff;padding:12px 16px;border-radius:8px 8px 0 0;font-weight:bold">${esc(c.label)}</div>
<div style="background:#fff;padding:16px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:0">
<p style="margin:0 0 12px"><strong>${esc(r.name)}</strong> (${esc(r.rollNo)})<br>${esc(r.className)}<br>Report for <strong>${esc(month)}</strong></p>
<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:12px">
<tr><td style="padding:4px 0">Working days</td><td style="text-align:right"><strong>${r.workingDays}</strong></td></tr>
<tr><td style="padding:4px 0">Days present</td><td style="text-align:right"><strong>${r.daysPresent}</strong></td></tr>
<tr><td style="padding:4px 0">Attendance this month</td><td style="text-align:right"><strong>${esc(pct(r.percent))}</strong></td></tr>
<tr><td style="padding:4px 0">Attendance this year</td><td style="text-align:right;color:${c.bg}"><strong>${esc(pct(r.yearPercent))}</strong></td></tr>
</table>
<table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="text-align:left;color:#475569"><th style="padding:6px 8px">Subject</th><th style="padding:6px 8px;text-align:right">Classes</th><th style="padding:6px 8px;text-align:right">%</th></tr>${rows}</table>
<p style="font-size:14px;margin:16px 0 0">${esc(advice)}</p>
</div>
<p style="font-size:12px;color:#64748b">${opts.unsubscribeUrl && !opts.forCoordinator && r.risk !== "CRITICAL" ? `To stop monthly reports (critical alerts will still be sent), <a href="${esc(opts.unsubscribeUrl)}">unsubscribe here</a>.` : esc(footer)}</p>
</div></body></html>`;
  return { subject, text, html };
}

/** FR-36..38: build the month's reports, queue the emails, alert, and record a run. */
export async function generateMonthlyReports(monthKey: string, trigger: "SCHEDULED" | "MANUAL", actorId?: string) {
  const settings = await getSettings();
  const reports = await buildMonthlyReports(monthKey);
  const run = await db.reportRun.create({ data: { monthKey, trigger, createdById: actorId } });
  const students = await db.student.findMany({
    where: { id: { in: reports.map((r) => r.studentId) } },
    include: { parents: { include: { parent: true } }, mentor: { include: { user: { select: { email: true } } } } },
  });
  const emails: QueuedEmail[] = [];
  const warnStudents: string[] = [];
  const warnParents: string[] = [];
  for (const r of reports) {
    const s = students.find((x) => x.id === r.studentId)!;
    const critical = r.risk === "CRITICAL";
    for (const { parent } of s.parents) {
      if (critical ? parent.criticalOptOutApproved : parent.unsubscribedNonCritical) continue;
      const mail = renderReport(r, settings, { unsubscribeUrl: `${appUrl()}/unsubscribe/${parent.unsubscribeToken}` });
      emails.push({
        kind: critical ? "LOW_ATTENDANCE" : "MONTHLY_REPORT",
        to: parent.email,
        ...mail,
        priority: critical ? 2 : r.risk === "WARNING" ? 1 : 0,
        runId: run.id,
        studentId: s.id,
        parentId: parent.id,
      });
      if (critical && settings.smsOnCritical && parent.phone) {
        await sendSms(parent.phone, `${COLLEGE_NAME}: ${r.name}'s attendance is ${pct(r.yearPercent)}, below ${settings.criticalThreshold}%. Please contact the college.`);
      }
      if (parent.userId && r.risk !== "OK") warnParents.push(parent.userId);
    }
    if (critical && settings.copyCoordinatorOnCritical && s.mentor?.user.email) {
      const mail = renderReport(r, settings, { forCoordinator: true });
      emails.push({ kind: "COORDINATOR_COPY", to: s.mentor.user.email, ...mail, subject: `[Copy] ${mail.subject}`, priority: 2, runId: run.id, studentId: s.id });
    }
    if (r.risk === "WARNING" || critical) warnStudents.push(s.userId);
  }
  await enqueueEmails(emails);
  // FR-35 low-attendance warning in the app as well.
  await notifyUsers(warnStudents, { title: "Low attendance warning", body: `Your attendance is below ${settings.warningThreshold}%. See how many classes you need.`, link: "/student/attendance" });
  await notifyUsers(warnParents, { title: "Low attendance warning", body: "Your child's attendance is below the requirement.", link: "/parent/attendance" });
  const warnings = reports.filter((r) => r.risk === "WARNING").length;
  const critical = reports.filter((r) => r.risk === "CRITICAL").length;
  await db.reportRun.update({ where: { id: run.id }, data: { students: reports.length, warnings, critical } });
  await logAudit({ actorId, action: "PARENT_REPORTS_GENERATED", entityType: "ReportRun", entityId: run.id, details: { monthKey, trigger, students: reports.length, emails: emails.length, warnings, critical } });
  return { runId: run.id, students: reports.length, emails: emails.length, warnings, critical };
}

/** FR-36: on the set day each month (catching up if missed), report on the previous month. */
export async function maybeRunScheduledReports(now = new Date()): Promise<number> {
  const settings = await getSettings();
  if (settings.reportsPaused) return 0;
  const today = toDateKey(now);
  if (Number(today.slice(8)) < settings.reportDayOfMonth || minutesOfDay(now) < 7 * 60) return 0;
  const monthKey = shiftMonth(today.slice(0, 7), -1);
  const done = await db.reportRun.findFirst({ where: { monthKey, trigger: "SCHEDULED" } });
  if (done) return 0;
  const r = await generateMonthlyReports(monthKey, "SCHEDULED");
  return r.emails;
}
