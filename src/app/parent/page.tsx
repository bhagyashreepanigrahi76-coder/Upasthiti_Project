import type { Metadata } from "next";
import { requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, ComingSoon, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Parent dashboard" };

export default async function ParentDashboardPage() {
  const user = await requirePortal("parent");

  // Only students linked to this parent (read-only view, PRD §3).
  const parent = await db.parent.findUnique({
    where: { userId: user.id },
    include: {
      students: {
        include: {
          student: {
            include: {
              user: { select: { name: true } },
              department: true,
              section: true,
              mentor: { include: { user: { select: { name: true, email: true } } } },
            },
          },
        },
      },
    },
  });

  const children = parent?.students.map((link) => ({ ...link.student, relationship: link.relationship })) ?? [];

  return (
    <>
      <PageHeader
        title="Parent dashboard"
        subtitle={parent ? `Reports are emailed to ${parent.email}` : undefined}
      />

      {children.length === 0 ? (
        <EmptyState>No student is linked to your account yet. Please contact the college office.</EmptyState>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {children.map((s) => (
            <Card key={s.id} title={s.user.name}>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Roll number</dt>
                  <dd className="font-mono text-slate-900">{s.rollNo}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Year / Section</dt>
                  <dd className="text-slate-900">
                    Year {s.year} · {s.section.name}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Programme</dt>
                  <dd className="text-slate-900">{s.department.programme}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Class coordinator</dt>
                  <dd className="text-slate-900">
                    {s.mentor ? `${s.mentor.user.name}${s.mentor.user.email ? ` · ${s.mentor.user.email}` : ""}` : "Not assigned"}
                  </dd>
                </div>
              </dl>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <ComingSoon day={9}>Monthly attendance summary and low-attendance alerts.</ComingSoon>
        <ComingSoon day={9}>Published internal and semester results.</ComingSoon>
      </div>
    </>
  );
}
