import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { buildMonthlyReports, renderReport } from "@/lib/reports";
import { formatMonthKey, isMonthKey } from "@/lib/dates";
import { Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Report preview" };

type Props = { searchParams: Promise<{ student?: string; month?: string }> };

// FR-39: preview exactly what a parent will receive.
export default async function ReportPreviewPage({ searchParams }: Props) {
  await requireRole("ADMIN");
  const { student, month } = await searchParams;
  const monthKey = isMonthKey(month) ? month : null;
  const [report] = student && monthKey ? await buildMonthlyReports(monthKey, [student]) : [];
  const mail = report ? renderReport(report, await getSettings(), { unsubscribeUrl: "https://example.invalid/unsubscribe/preview" }) : null;
  return (
    <>
      <PageHeader
        title="Report preview"
        subtitle={
          <>
            {monthKey ? formatMonthKey(monthKey) : "Choose a student and month"} ·{" "}
            <Link href="/admin/reports" className="text-brand-700 hover:underline">Back to parent reports</Link>
          </>
        }
      />
      {!mail ? (
        <EmptyState>No classes were recorded for this student in that month, so no report would be sent.</EmptyState>
      ) : (
        <Card title={`Subject: ${mail.subject}`}>
          {/* Sandboxed so the email HTML cannot run scripts or touch this page. */}
          <iframe title="Email preview" sandbox="" srcDoc={mail.html} className="h-[640px] w-full rounded-md border border-slate-200 bg-white" />
        </Card>
      )}
    </>
  );
}
