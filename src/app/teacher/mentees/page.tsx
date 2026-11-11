import type { Metadata } from "next";
import Link from "next/link";
import { getTeacherProfile, requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { attendanceFor, riskLevel, type Risk } from "@/lib/attendance";
import { toDateKey } from "@/lib/dates";
import { Badge, Card, EmptyState, PageHeader, StatCard, Table, td } from "@/components/ui";

export const metadata: Metadata = { title: "Mentees" };

const RISK_ORDER: Record<Risk, number> = { CRITICAL: 0, WARNING: 1, NONE: 2, OK: 3 };

// Class coordinator view (PRD §3): full attendance of own mentees, parent
// contacts and a risk list.
export default async function MenteesPage() {
  const user = await requirePortal("teacher");
  const teacher = await getTeacherProfile(user.id);
  if (!teacher || !user.roles.includes("MENTOR")) {
    return (
      <>
        <PageHeader title="Mentees" />
        <EmptyState>This page is for class coordinators.</EmptyState>
      </>
    );
  }
  const [settings, ay, mentees] = await Promise.all([
    getSettings(),
    db.academicYear.findFirst({ where: { isCurrent: true } }),
    db.student.findMany({
      where: { mentorId: teacher.id, status: "ACTIVE" },
      include: { user: { select: { name: true } }, section: true, parents: { include: { parent: true } } },
      orderBy: { rollNo: "asc" },
    }),
  ]);
  const data = await attendanceFor(
    mentees.map((m) => m.id),
    { from: ay?.startDate.toISOString().slice(0, 10), to: toDateKey(new Date()) },
  );
  const rows = mentees
    .map((m) => ({ m, t: data.get(m.id)!.overall, risk: riskLevel(data.get(m.id)!.overall.percent, settings) }))
    .sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || (a.t.percent ?? 101) - (b.t.percent ?? 101));
  const count = (r: Risk) => rows.filter((x) => x.risk === r).length;

  return (
    <>
      <PageHeader title="My mentees" subtitle={`Warning below ${settings.warningThreshold}%, critical below ${settings.criticalThreshold}%.`} />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Mentees" value={mentees.length} />
        <StatCard label="Critical" value={count("CRITICAL")} />
        <StatCard label="Below requirement" value={count("WARNING")} />
        <StatCard label="On track" value={count("OK")} />
      </div>
      <Card title="Risk list (most at risk first)">
        {rows.length === 0 ? (
          <EmptyState>No mentees assigned.</EmptyState>
        ) : (
          <Table head={["Student", "Attendance", "Classes", "Status", "Parent contact"]}>
            {rows.map(({ m, t, risk }) => (
              <tr key={m.id}>
                <td className={td}>
                  <Link href={`/teacher/mentees/${m.id}`} className="font-medium text-brand-700 hover:underline">
                    {m.user.name}
                  </Link>
                  <span className="block text-xs text-slate-500">
                    {m.rollNo} · Y{m.year}-{m.section.name}
                  </span>
                </td>
                <td className={`${td} tabular-nums font-medium`}>{t.percent === null ? "–" : `${t.percent}%`}</td>
                <td className={`${td} tabular-nums text-xs`}>
                  {t.attended}/{t.held}
                </td>
                <td className={td}>
                  {risk === "CRITICAL" ? <Badge tone="red">Critical</Badge> : risk === "WARNING" ? <Badge tone="amber">Warning</Badge> : risk === "OK" ? <Badge tone="green">OK</Badge> : <Badge>No data</Badge>}
                </td>
                <td className={`${td} text-xs`}>
                  {m.parents.map((p) => (
                    <span key={p.parentId} className="block">
                      {p.parent.name}: {p.parent.email}
                      {p.parent.phone && ` · ${p.parent.phone}`}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
