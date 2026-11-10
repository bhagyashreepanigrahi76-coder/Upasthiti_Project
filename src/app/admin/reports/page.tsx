import type { Metadata } from "next";
import Link from "next/link";
import type { EmailStatus, Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { formatMonthKey, shiftMonth, toDateKey } from "@/lib/dates";
import { formatDateTime } from "@/lib/config";
import { Badge, Card, EmptyState, PageHeader, StatCard, Table, td } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/forms";
import { Checkbox, Field, Input, Select, inputClass } from "@/components/form-fields";
import { generateReportsNow, resend, saveReportSettings, sendQueueNow, setRunStatus } from "@/app/report-actions/actions";

export const metadata: Metadata = { title: "Parent reports" };

const STATUS_TONE: Record<EmailStatus, "slate" | "green" | "amber" | "red" | "brand"> = {
  QUEUED: "brand",
  SENDING: "brand",
  SENT: "green",
  FAILED: "red",
  BOUNCED: "red",
  CANCELLED: "slate",
};
const STATUSES: EmailStatus[] = ["QUEUED", "SENDING", "SENT", "FAILED", "BOUNCED", "CANCELLED"];

type Props = { searchParams: Promise<{ status?: string; q?: string }> };

export default async function ParentReportsPage({ searchParams }: Props) {
  await requireRole("ADMIN");
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as EmailStatus) ? (sp.status as EmailStatus) : undefined;
  const q = sp.q?.trim();
  const where: Prisma.EmailLogWhereInput = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ toAddress: { contains: q.toLowerCase() } }, { subject: { contains: q } }] } : {}),
  };
  const lastMonth = shiftMonth(toDateKey(new Date()).slice(0, 7), -1);

  const [settings, runs, counts, emails, students] = await Promise.all([
    getSettings(),
    db.reportRun.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
    db.emailLog.groupBy({ by: ["runId", "status"], _count: true }),
    db.emailLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 }),
    db.student.findMany({ where: { status: "ACTIVE" }, orderBy: { rollNo: "asc" }, include: { user: { select: { name: true } } }, take: 500 }),
  ]);
  const total = (s: EmailStatus) => counts.filter((c) => c.status === s).reduce((n, c) => n + c._count, 0);
  const runCount = (runId: string, s: EmailStatus) => counts.find((c) => c.runId === runId && c.status === s)?._count ?? 0;

  return (
    <>
      <PageHeader title="Parent reports" subtitle={`Monthly attendance emails go out on day ${settings.reportDayOfMonth} of each month for the previous month (FR-36).`} />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Waiting to send" value={total("QUEUED")} />
        <StatCard label="Sent" value={total("SENT")} />
        <StatCard label="Bounced" value={total("BOUNCED")} hint="Wrong or closed address" />
        <StatCard label="Failed" value={total("FAILED")} hint="After 5 tries" />
        <StatCard label="Reports paused" value={settings.reportsPaused ? "Yes" : "No"} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Send reports now">
          <ActionForm action={generateReportsNow} submitLabel="Generate and queue" confirmText="Generate this month's reports and queue the emails?">
            <Field label="Month" name="monthKey">
              <Input name="monthKey" type="month" defaultValue={lastMonth} />
            </Field>
          </ActionForm>
          <div className="mt-4 border-t border-slate-100 pt-4">
            <ActionForm action={sendQueueNow} submitLabel="Send queued emails now" tone="secondary" className="space-y-2" />
            <p className="mt-2 text-xs text-slate-500">The scheduled job also sends the queue every few minutes.</p>
          </div>
        </Card>

        <Card title="Preview a report">
          <form method="get" action="/admin/reports/preview" className="space-y-3">
            <Select name="student" aria-label="Student" options={students.map((s) => ({ value: s.id, label: `${s.rollNo} · ${s.user.name}` }))} />
            <input name="month" type="month" defaultValue={lastMonth} aria-label="Month" className={inputClass} />
            <button className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Preview</button>
          </form>
        </Card>

        <Card title="Settings">
          <ActionForm action={saveReportSettings} submitLabel="Save" tone="secondary">
            <Field label="Send on day of month" name="reportDayOfMonth" hint="1-28">
              <Input name="reportDayOfMonth" type="number" min={1} max={28} defaultValue={settings.reportDayOfMonth} />
            </Field>
            <div className="flex flex-col gap-2">
              <Checkbox name="reportsPaused" label="Pause scheduled reports" defaultChecked={settings.reportsPaused} />
              <Checkbox name="copyCoordinatorOnCritical" label="Copy the class coordinator on critical alerts" defaultChecked={settings.copyCoordinatorOnCritical} />
              <Checkbox name="smsOnCritical" label="Also SMS parents on critical alerts" defaultChecked={settings.smsOnCritical} />
            </div>
            <p className="text-xs text-slate-500">
              Warning below {settings.warningThreshold}%, critical below {settings.criticalThreshold}% (change in Geofence &amp; hours).
            </p>
          </ActionForm>
        </Card>
      </div>

      <Card title="Report runs" className="mt-6">
        {runs.length === 0 ? (
          <EmptyState>No reports generated yet.</EmptyState>
        ) : (
          <Table head={["Month", "Started", "Students", "Warnings / critical", "Emails", "Status", ""]}>
            {runs.map((r) => (
              <tr key={r.id}>
                <td className={`${td} font-medium`}>{formatMonthKey(r.monthKey)}</td>
                <td className={`${td} text-xs`}>
                  {formatDateTime(r.createdAt)} · {r.trigger.toLowerCase()}
                </td>
                <td className={`${td} tabular-nums`}>{r.students}</td>
                <td className={`${td} tabular-nums`}>
                  {r.warnings} / <span className="text-red-700">{r.critical}</span>
                </td>
                <td className={`${td} text-xs`}>
                  {runCount(r.id, "SENT")} sent · {runCount(r.id, "QUEUED")} waiting · {runCount(r.id, "BOUNCED") + runCount(r.id, "FAILED")} problems
                </td>
                <td className={td}>
                  <Badge tone={r.status === "COMPLETED" ? "green" : r.status === "PAUSED" ? "amber" : r.status === "CANCELLED" ? "slate" : "brand"}>{r.status}</Badge>
                </td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  {r.status === "SENDING" && <ActionButton action={setRunStatus} fields={{ id: r.id, to: "PAUSED" }} label="Pause" />}
                  {r.status === "PAUSED" && <ActionButton action={setRunStatus} fields={{ id: r.id, to: "SENDING" }} label="Resume" tone="success" />}{" "}
                  {(r.status === "SENDING" || r.status === "PAUSED") && (
                    <ActionButton action={setRunStatus} fields={{ id: r.id, to: "CANCELLED" }} label="Cancel" tone="danger" confirmText="Cancel the unsent emails of this run?" />
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Delivery log" className="mt-6">
        <form method="get" className="mb-3 flex flex-wrap gap-2">
          <select name="status" defaultValue={status ?? ""} className={`${inputClass} max-w-40`} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </select>
          <input name="q" defaultValue={q} placeholder="Email or subject" className={`${inputClass} max-w-xs`} aria-label="Search" />
          <button className="rounded-md bg-slate-800 px-3 text-sm font-medium text-white">Filter</button>
          {(status || q) && (
            <Link href="/admin/reports" className="self-center text-xs text-slate-500 hover:underline">
              Clear
            </Link>
          )}
        </form>
        {emails.length === 0 ? (
          <EmptyState>No emails match.</EmptyState>
        ) : (
          <Table head={["Queued", "To", "Subject", "Status", "Tries", ""]}>
            {emails.map((e) => (
              <tr key={e.id}>
                <td className={`${td} whitespace-nowrap text-xs`}>{formatDateTime(e.createdAt)}</td>
                <td className={`${td} text-xs`}>{e.toAddress}</td>
                <td className={`${td} max-w-sm text-xs`}>
                  {e.subject}
                  <span className="block text-slate-400">{e.kind.replace("_", " ").toLowerCase()}</span>
                </td>
                <td className={td}>
                  <Badge tone={STATUS_TONE[e.status]}>{e.status.toLowerCase()}</Badge>
                  {e.lastError && <span className="block max-w-56 text-xs text-red-700">{e.lastError}</span>}
                  {e.sentAt && <span className="block text-xs text-slate-500">{formatDateTime(e.sentAt)}</span>}
                </td>
                <td className={`${td} tabular-nums`}>{e.attempts}</td>
                <td className={`${td} text-right`}>
                  {(e.status === "FAILED" || e.status === "BOUNCED" || e.status === "SENT") && <ActionButton action={resend} fields={{ id: e.id }} label="Resend" />}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
