import Link from "next/link";
import { analytics } from "@/lib/analytics";
import { db } from "@/lib/db";
import { Badge, Card, EmptyState, StatCard, Table, td } from "./ui";
import { DailyAttendanceChart } from "./daily-attendance-chart";

// FR-29 dashboard body, shared by Admin (whole college) and HOD (own departments).
export async function AnalyticsView({ departmentIds, mentorLinkBase }: { departmentIds: string[] | null; mentorLinkBase?: string }) {
  const a = await analytics(departmentIds);
  const critical = a.defaulters.filter((d) => d.risk === "CRITICAL").length;
  const ay = await db.academicYear.findFirst({ where: { isCurrent: true } });
  const sections = await db.section.findMany({
    where: { academicYearId: ay?.id, ...(departmentIds ? { departmentId: { in: departmentIds } } : {}) },
    include: { department: true },
    orderBy: [{ department: { code: "asc" } }, { year: "asc" }, { name: "asc" }],
  });
  const exportQs = departmentIds ? `&dept=${departmentIds.join(",")}` : "";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active students" value={a.students} />
        <StatCard label={`Below ${a.settings.warningThreshold}%`} value={a.defaulters.length} hint="This academic year" />
        <StatCard label={`Critical (below ${a.settings.criticalThreshold}%)`} value={critical} />
        <StatCard label="Punch exceptions (7 days)" value={a.exceptions.reduce((n, e) => n + e.count, 0)} hint={`${a.flagged} flagged`} />
      </div>

      <Card title="Class attendance by day (last 30 days)">
        <DailyAttendanceChart data={a.daily} target={a.settings.warningThreshold} />
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Department and year comparison">
          {a.comparison.length === 0 ? (
            <EmptyState>No students.</EmptyState>
          ) : (
            <Table head={["Class", "Students", "Average", "Warning", "Critical"]}>
              {a.comparison.map((g) => (
                <tr key={`${g.departmentCode}-${g.year}`}>
                  <td className={`${td} font-medium`}>
                    {g.departmentCode} Year {g.year}
                  </td>
                  <td className={`${td} tabular-nums`}>{g.students}</td>
                  <td className={`${td} tabular-nums`}>{g.average === null ? "–" : `${g.average}%`}</td>
                  <td className={`${td} tabular-nums`}>{g.warning}</td>
                  <td className={`${td} tabular-nums`}>{g.critical}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Punch exceptions in the last 7 days">
          {a.exceptions.length === 0 ? (
            <EmptyState>No rejected punches.</EmptyState>
          ) : (
            <Table head={["Reason", "Rejected punches"]}>
              {a.exceptions.map((e) => (
                <tr key={e.reason}>
                  <td className={`${td} font-mono text-xs`}>{e.reason}</td>
                  <td className={`${td} tabular-nums`}>{e.count}</td>
                </tr>
              ))}
            </Table>
          )}
          {!departmentIds && (
            <Link href="/admin/punches?show=rejected" className="mt-3 inline-block text-xs font-medium text-brand-700 hover:underline">
              Open the punch log
            </Link>
          )}
        </Card>
      </div>

      <Card
        title={`Defaulters (${a.defaulters.length})`}
        action={
          <div className="flex gap-3 text-xs font-medium">
            <a href={`/api/exports/defaulters?format=xlsx${exportQs}`} className="text-brand-700 hover:underline">
              Excel
            </a>
            <a href={`/api/exports/defaulters?format=csv${exportQs}`} className="text-brand-700 hover:underline">
              CSV
            </a>
          </div>
        }
      >
        {a.defaulters.length === 0 ? (
          <EmptyState>Everyone is at or above {a.settings.warningThreshold}%.</EmptyState>
        ) : (
          <Table head={["Student", "Class", "Attendance", "Classes", "Status"]}>
            {a.defaulters.slice(0, 100).map((d) => (
              <tr key={d.studentId}>
                <td className={td}>
                  {mentorLinkBase ? (
                    <Link href={`${mentorLinkBase}/${d.userId}`} className="text-brand-700 hover:underline">
                      {d.name}
                    </Link>
                  ) : (
                    d.name
                  )}
                  <span className="block font-mono text-xs text-slate-500">{d.rollNo}</span>
                </td>
                <td className={td}>{d.className}</td>
                <td className={`${td} tabular-nums font-medium`}>{d.percent === null ? "–" : `${d.percent}%`}</td>
                <td className={`${td} tabular-nums`}>{d.held}</td>
                <td className={td}>{d.risk === "CRITICAL" ? <Badge tone="red">Critical</Badge> : <Badge tone="amber">Warning</Badge>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Attendance registers (for records and accreditation)">
        <p className="mb-3 text-sm text-slate-600">Download a section&apos;s attendance for a month: one row per student, one column per class held.</p>
        <form method="get" action="/api/exports/attendance" className="flex flex-wrap items-end gap-2">
          <select name="section" aria-label="Section" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.department.code} {s.year}-{s.name}
              </option>
            ))}
          </select>
          <input name="month" type="month" aria-label="Month" defaultValue={a.daily[a.daily.length - 1].dateKey.slice(0, 7)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <select name="format" aria-label="Format" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="xlsx">Excel</option>
            <option value="csv">CSV</option>
          </select>
          <button className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white">Download</button>
        </form>
      </Card>
    </div>
  );
}
