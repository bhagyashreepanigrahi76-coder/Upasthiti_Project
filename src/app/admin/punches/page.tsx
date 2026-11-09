import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateKey, formatTime, isDateKey, toDateKey } from "@/lib/dates";
import { Badge, Card, EmptyState, PageHeader, StatCard, Table, td } from "@/components/ui";
import { inputClass } from "@/components/form-fields";
import { ActionForm } from "@/components/forms";
import { closeOpenSessionsNow } from "./actions";

export const metadata: Metadata = { title: "Punch log" };

type Props = { searchParams: Promise<{ date?: string; show?: string }> };

export default async function PunchLogPage({ searchParams }: Props) {
  await requireRole("ADMIN");
  const sp = await searchParams;
  const date = isDateKey(sp.date) ? sp.date : toDateKey(new Date());
  const show = sp.show === "rejected" || sp.show === "flagged" ? sp.show : "all";

  const where: Prisma.PunchRecordWhereInput = {
    dateKey: date,
    ...(show === "rejected" ? { status: "REJECTED" } : {}),
    ...(show === "flagged" ? { flags: { not: null } } : {}),
  };
  const [punches, sessions, rejected, flagged] = await Promise.all([
    db.punchRecord.findMany({
      where,
      orderBy: { serverTime: "desc" },
      take: 200,
      include: { student: { include: { user: { select: { name: true } }, section: true } } },
    }),
    db.campusSession.groupBy({ by: ["status"], where: { dateKey: date }, _count: true }),
    db.punchRecord.count({ where: { dateKey: date, status: "REJECTED" } }),
    db.punchRecord.count({ where: { dateKey: date, flags: { not: null } } }),
  ]);
  const count = (s: string) => sessions.find((x) => x.status === s)?._count ?? 0;
  const present = sessions.reduce((n, s) => n + s._count, 0);

  return (
    <>
      <PageHeader title="Punch log" subtitle={formatDateKey(date)}>
        <form method="get" className="flex gap-2">
          <input type="date" name="date" defaultValue={date} className={inputClass} aria-label="Date" />
          <select name="show" defaultValue={show} className={inputClass} aria-label="Show">
            <option value="all">All punches</option>
            <option value="rejected">Rejected only</option>
            <option value="flagged">Flagged only</option>
          </select>
          <button className="rounded-md bg-slate-800 px-3 text-sm font-medium text-white">Show</button>
        </form>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Students on campus" value={present} hint="Any session that day" />
        <StatCard label="Still punched in" value={count("OPEN")} />
        <StatCard label="Incomplete" value={count("INCOMPLETE")} hint="No punch-out" />
        <StatCard label="Rejected punches" value={rejected} />
        <StatCard label="Flagged punches" value={flagged} hint="Clock, speed, late sync" />
      </div>

      <Card
        title="Punches"
        className="mt-6"
        action={
          <ActionForm
            action={closeOpenSessionsNow}
            submitLabel="Close open sessions from earlier days"
            tone="secondary"
            className="flex flex-col items-end gap-1"
          />
        }
      >
        {punches.length === 0 ? (
          <EmptyState>No punches for this filter.</EmptyState>
        ) : (
          <Table head={["Time", "Student", "Type", "Result", "Distance", "Accuracy", "Flags / reason"]}>
            {punches.map((p) => {
              const flags: string[] = p.flags ? JSON.parse(p.flags) : [];
              return (
                <tr key={p.id}>
                  <td className={`${td} whitespace-nowrap tabular-nums`}>
                    {formatTime(p.effectiveTime)}
                    {p.source === "OFFLINE" && <span className="block text-xs text-slate-500">offline · synced {formatTime(p.serverTime)}</span>}
                  </td>
                  <td className={td}>
                    <Link href={`/admin/users/${p.student.userId}`} className="text-brand-700 hover:underline">
                      {p.student.user.name}
                    </Link>
                    <span className="block text-xs text-slate-500">
                      {p.student.rollNo} · Y{p.student.year}-{p.student.section.name}
                    </span>
                  </td>
                  <td className={td}>{p.type === "IN" ? "In" : "Out"}</td>
                  <td className={td}>
                    <Badge tone={p.status === "ACCEPTED" ? "green" : "red"}>{p.status === "ACCEPTED" ? "Accepted" : p.reason ?? "Rejected"}</Badge>
                  </td>
                  <td className={`${td} tabular-nums`}>{p.distanceMeters != null ? `${Math.round(p.distanceMeters)} m` : "–"}</td>
                  <td className={`${td} tabular-nums`}>±{Math.round(p.accuracyMeters)} m</td>
                  <td className={`${td} text-xs`}>
                    {flags.map((f) => (
                      <Badge key={f} tone="amber">
                        {f}
                      </Badge>
                    ))}
                    {p.status === "REJECTED" && <span className="block text-slate-600">{p.message}</span>}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}
