import type { Metadata } from "next";
import Link from "next/link";
import { getTeacherProfile, requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { addDays, formatDateKey, isDateKey, toDateKey } from "@/lib/dates";
import { teacherDay, type ScheduledPeriod } from "@/lib/timetable";
import { Badge, Card, EmptyState, PageHeader, Table, td } from "@/components/ui";
import { inputClass } from "@/components/form-fields";

export const metadata: Metadata = { title: "Mark attendance" };

type Props = { searchParams: Promise<{ date?: string }> };

const markHref = (date: string, p: ScheduledPeriod) => `/teacher/attendance/${date}/${encodeURIComponent(p.periodKey)}`;

export default async function TeacherAttendancePage({ searchParams }: Props) {
  const user = await requirePortal("teacher");
  const teacher = await getTeacherProfile(user.id);
  if (!teacher) return <EmptyState>Your teacher profile has not been set up yet.</EmptyState>;

  const today = toDateKey(new Date());
  const { date } = await searchParams;
  const day = isDateKey(date) && date <= today ? date : today;

  // Periods this teacher takes (own, substitutions, extra classes), not cancelled or handed over.
  const mine = (ps: ScheduledPeriod[]) => ps.filter((p) => p.status !== "CANCELLED" && p.teacherId === teacher.id);

  const periods = mine(await teacherDay(teacher.id, day));
  const recentDays = Array.from({ length: 7 }, (_, i) => addDays(today, -(i + 1)));
  const recent = await Promise.all(recentDays.map(async (d) => ({ d, periods: mine(await teacherDay(teacher.id, d)) })));

  const keys = [...periods.map((p) => ({ dateKey: day, periodKey: p.periodKey })), ...recent.flatMap((r) => r.periods.map((p) => ({ dateKey: r.d, periodKey: p.periodKey })))];
  const taken = await db.classSession.findMany({
    where: { OR: keys.length ? keys : [{ dateKey: "none" }] },
    include: { records: { select: { status: true } }, editRequests: { where: { status: "PENDING" }, select: { id: true } } },
  });
  const sessionFor = (d: string, p: ScheduledPeriod) => taken.find((s) => s.dateKey === d && s.periodKey === p.periodKey);
  const pending = recent.flatMap((r) => r.periods.filter((p) => !sessionFor(r.d, p)).map((p) => ({ d: r.d, p })));

  return (
    <>
      <PageHeader title="Mark attendance" subtitle="Attendance can only be marked for periods on the timetable (FR-61).">
        <form method="get" className="flex gap-2">
          <input type="date" name="date" defaultValue={day} max={today} className={inputClass} aria-label="Date" />
          <button className="rounded-md bg-slate-800 px-3 text-sm font-medium text-white">Show</button>
        </form>
      </PageHeader>

      <Card title={day === today ? `Today · ${formatDateKey(day)}` : formatDateKey(day)}>
        {periods.length === 0 ? (
          <EmptyState>No periods for you on this day.</EmptyState>
        ) : (
          <Table head={["Period", "Class", "Subject", "Status", ""]}>
            {periods.map((p) => {
              const s = sessionFor(day, p);
              const absent = s?.records.filter((r) => r.status === "ABSENT").length ?? 0;
              return (
                <tr key={p.key}>
                  <td className={`${td} whitespace-nowrap tabular-nums`}>
                    P{p.periodNumber} · {p.start}
                  </td>
                  <td className={td}>
                    {p.sectionLabel}
                    {p.batchName && <span className="text-slate-500"> · {p.batchName}</span>}
                  </td>
                  <td className={td}>
                    {p.subject}
                    {p.status === "SUBSTITUTED" && <Badge tone="amber">Covering</Badge>}
                    {p.status === "EXTRA" && <Badge tone="green">Extra</Badge>}
                  </td>
                  <td className={td}>
                    {s ? (
                      <Badge tone="green">
                        Taken · {s.records.length - absent}/{s.records.length}
                      </Badge>
                    ) : (
                      <Badge tone="amber">Not taken</Badge>
                    )}
                    {s && s.editRequests.length > 0 && <Badge tone="brand">Edit pending</Badge>}
                  </td>
                  <td className={`${td} text-right`}>
                    <Link href={markHref(day, p)} className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700">
                      {s ? "View / edit" : "Mark"}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <Card title={`Not yet marked in the last 7 days (${pending.length})`} className="mt-6">
        {pending.length === 0 ? (
          <EmptyState>All caught up.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {pending.map(({ d, p }) => (
              <li key={`${d}-${p.key}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  {formatDateKey(d)} · P{p.periodNumber} · {p.sectionLabel} · {p.subject}
                </span>
                <Link href={markHref(d, p)} className="text-xs font-medium text-brand-700 hover:underline">
                  Mark now
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
