import type { Metadata } from "next";
import Link from "next/link";
import { departmentsFor, requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatLongDate } from "@/lib/config";
import { Badge, Card, ComingSoon, EmptyState, PageHeader, StatCard } from "@/components/ui";

export const metadata: Metadata = { title: "HOD dashboard" };

export default async function HodDashboardPage() {
  const user = await requirePortal("hod");
  // A HOD only sees their own department(s) (PRD §3).
  const departmentIds = departmentsFor(user, "HOD");

  const departments = await db.department.findMany({
    where: { id: { in: departmentIds } },
    orderBy: { code: "asc" },
    include: {
      _count: { select: { subjects: true, sections: true } },
      teachers: {
        orderBy: { user: { name: "asc" } },
        include: {
          user: { select: { name: true, collegeId: true } },
          _count: { select: { subjects: true, mentees: true } },
        },
      },
    },
  });
  const studentCounts = await db.student.groupBy({
    by: ["departmentId", "year"],
    where: { departmentId: { in: departmentIds }, status: "ACTIVE" },
    _count: true,
  });

  return (
    <>
      <PageHeader title="Department overview" subtitle={formatLongDate(new Date())} />

      {departments.length === 0 && (
        <EmptyState>No department is linked to your HOD role yet. Ask the admin to assign one.</EmptyState>
      )}

      {departments.map((dept) => {
        const yearCount = (y: number) =>
          studentCounts.find((r) => r.departmentId === dept.id && r.year === y)?._count ?? 0;
        const total = [1, 2, 3].reduce((sum, y) => sum + yearCount(y), 0);

        return (
          <div key={dept.id} className="mb-8">
            <h2 className="mb-3 text-lg font-semibold text-slate-900">
              {dept.programme} <span className="text-sm font-normal text-slate-500">({dept.code})</span>
            </h2>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
              <StatCard label="Students" value={total} />
              <StatCard label="Year 1" value={yearCount(1)} />
              <StatCard label="Year 2" value={yearCount(2)} />
              <StatCard label="Year 3" value={yearCount(3)} />
              <StatCard label="Teachers" value={dept.teachers.length} />
              <StatCard label="Subjects" value={dept._count.subjects} />
            </div>

            <Card title="Teachers" className="mt-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-3 font-medium">Name</th>
                      <th className="py-2 pr-3 font-medium">ID</th>
                      <th className="py-2 pr-3 font-medium">Designation</th>
                      <th className="py-2 pr-3 text-right font-medium">Classes</th>
                      <th className="py-2 text-right font-medium">Mentees</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dept.teachers.map((t) => (
                      <tr key={t.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pr-3 font-medium text-slate-900">{t.user.name}</td>
                        <td className="py-2 pr-3 font-mono text-xs text-slate-600">{t.user.collegeId}</td>
                        <td className="py-2 pr-3 text-slate-600">{t.designation ?? "–"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{t._count.subjects}</td>
                        <td className="py-2 text-right tabular-nums">
                          {t._count.mentees > 0 ? <Badge tone="brand">{t._count.mentees}</Badge> : "–"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        );
      })}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Approvals and timetables">
          <p className="text-sm text-slate-600">
            <Link href="/hod/approvals" className="font-medium text-brand-700 hover:underline">
              Review leave and regularisation requests
            </Link>{" "}
            ·{" "}
            <Link href="/hod/timetable" className="font-medium text-brand-700 hover:underline">
              Edit department timetables
            </Link>
          </p>
        </Card>
        <ComingSoon day={7}>Verify submitted marks before they are locked and published.</ComingSoon>
      </div>
    </>
  );
}
