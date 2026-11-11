import type { Metadata } from "next";
import Link from "next/link";
import { toDateKey } from "@/lib/dates";
import { requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime, formatLongDate } from "@/lib/config";
import { Badge, Card, ComingSoon, EmptyState, PageHeader, StatCard } from "@/components/ui";

export const metadata: Metadata = { title: "Admin dashboard" };

const ACTION_TONES: Record<string, "green" | "red" | "amber" | "slate"> = {
  LOGIN_SUCCESS: "green",
  LOGIN_FAILED: "red",
  LOGIN_BLOCKED: "red",
  LOGOUT: "slate",
  SEED: "amber",
};

export default async function AdminDashboardPage() {
  await requirePortal("admin");

  const [academicYear, students, teachers, departments, sections, subjects, parents, byDeptYear, recent] =
    await Promise.all([
      db.academicYear.findFirst({ where: { isCurrent: true } }),
      db.student.count({ where: { status: "ACTIVE" } }),
      db.teacher.count(),
      db.department.findMany({ orderBy: { code: "asc" } }),
      db.section.count(),
      db.subject.count(),
      db.parent.count(),
      db.student.groupBy({ by: ["departmentId", "year"], where: { status: "ACTIVE" }, _count: true }),
      db.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 12,
        include: { actor: { select: { name: true, collegeId: true } } },
      }),
    ]);

  const today = toDateKey(new Date());
  const [todaySessions, todayRejected, pendingDevices, pendingLeave, pendingReg] = await Promise.all([
    db.campusSession.count({ where: { dateKey: today } }),
    db.punchRecord.count({ where: { dateKey: today, status: "REJECTED" } }),
    db.device.count({ where: { status: "PENDING" } }),
    db.leaveRequest.count({ where: { status: "PENDING" } }),
    db.regularisationRequest.count({ where: { status: "PENDING" } }),
  ]);
  const pendingRequests = pendingLeave + pendingReg;

  const countFor = (deptId: string, year: number) =>
    byDeptYear.find((r) => r.departmentId === deptId && r.year === year)?._count ?? 0;

  return (
    <>
      <PageHeader
        title="Admin dashboard"
        subtitle={`${formatLongDate(new Date())} · Academic year ${academicYear?.name ?? "not set"}`}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Active students" value={students} />
        <StatCard label="Teachers" value={teachers} />
        <StatCard label="Departments" value={departments.length} />
        <StatCard label="Sections" value={sections} />
        <StatCard label="Subjects" value={subjects} />
        <StatCard label="Parent contacts" value={parents} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Card title="Students by department and year" className="xl:col-span-2">
          {departments.length === 0 ? (
            <EmptyState>No departments yet.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3 font-medium">Department</th>
                    {[1, 2, 3].map((y) => (
                      <th key={y} className="px-2 py-2 text-right font-medium">
                        Year {y}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {departments.map((d) => (
                    <tr key={d.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-3">
                        <span className="font-medium text-slate-900">{d.code}</span>{" "}
                        <span className="text-slate-500">{d.programme}</span>
                      </td>
                      {[1, 2, 3].map((y) => (
                        <td key={y} className="px-2 py-2 text-right tabular-nums">
                          {countFor(d.id, y)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Recent activity" className="xl:col-span-3">
          {recent.length === 0 ? (
            <EmptyState>No activity recorded yet.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3 font-medium">When</th>
                    <th className="py-2 pr-3 font-medium">Who</th>
                    <th className="py-2 pr-3 font-medium">Action</th>
                    <th className="py-2 font-medium">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((log) => (
                    <tr key={log.id} className="border-b border-slate-100 last:border-0">
                      <td className="whitespace-nowrap py-2 pr-3 text-slate-600">{formatDateTime(log.createdAt)}</td>
                      <td className="py-2 pr-3">
                        {log.actor ? (
                          <>
                            {log.actor.name} <span className="text-slate-500">({log.actor.collegeId})</span>
                          </>
                        ) : (
                          <span className="text-slate-500">Unknown / system</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge tone={ACTION_TONES[log.action] ?? "slate"}>{log.action}</Badge>
                      </td>
                      <td className="py-2 font-mono text-xs text-slate-500">{log.ipAddress ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="On campus today" value={todaySessions} />
        <StatCard label="Rejected punches today" value={todayRejected} />
        <Link href="/admin/devices" className="block">
          <StatCard label="Device requests" value={pendingDevices} hint="Waiting for approval" />
        </Link>
        <StatCard label="Leave / regularisation" value={pendingRequests} hint="Pending with coordinators" />
        <Link href="/admin/punches" className="block">
          <StatCard label="Punch log" value="View" hint="Rejections and flags" />
        </Link>
      </div>
      <div className="mt-6">
        <ComingSoon day={9}>Day-wise attendance trends, defaulters list and department comparison.</ComingSoon>
      </div>
    </>
  );
}
