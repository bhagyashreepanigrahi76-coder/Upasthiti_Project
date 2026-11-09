import type { Metadata } from "next";
import Link from "next/link";
import { getTeacherProfile, requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateKey, isDateKey, minutesOfDay, toDateKey, weekdayOf } from "@/lib/dates";
import { effectiveTimetables, getTimings, teacherDay } from "@/lib/timetable";
import { markPeriodChange, removePeriodChange } from "@/app/timetable-actions/actions";
import { Badge, Card, EmptyState, PageHeader, StatCard, Table, td } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/forms";
import { Field, FieldGrid, Input, Select, inputClass } from "@/components/form-fields";
import { DayList, WeekGrid, gridRows, type GridSlot } from "@/components/timetable-views";

export const metadata: Metadata = { title: "My timetable" };

type Props = { searchParams: Promise<{ date?: string }> };

export default async function TeacherTimetablePage({ searchParams }: Props) {
  const user = await requirePortal("teacher");
  const teacher = await getTeacherProfile(user.id);
  if (!teacher) {
    return (
      <>
        <PageHeader title="My timetable" />
        <EmptyState>Your teacher profile has not been set up yet.</EmptyState>
      </>
    );
  }
  const { date } = await searchParams;
  const now = new Date();
  const today = toDateKey(now);
  const day = isDateKey(date) ? date : today;

  const [timings, tts, periods, mappings, myChanges] = await Promise.all([
    getTimings(),
    effectiveTimetables(today),
    teacherDay(teacher.id, day),
    db.teacherSubject.findMany({ where: { teacherId: teacher.id }, include: { subject: true, section: { include: { department: true } } } }),
    db.periodChange.findMany({
      where: { dateKey: { gte: today }, createdById: user.id },
      orderBy: [{ dateKey: "asc" }, { periodNumber: "asc" }],
      include: { section: { include: { department: true } }, subject: true },
    }),
  ]);
  const mySlots: GridSlot[] = tts.flatMap((tt) =>
    tt.slots
      .filter((s) => s.teacherId === teacher.id)
      .map((s) => ({ ...s, sectionLabel: `${tt.section.department.code} ${tt.section.year}-${tt.section.name}` })),
  );
  const weekly = mySlots.filter((s) => s.type !== "FREE").reduce((n, s) => n + s.span, 0);
  const sections = [...new Map(mappings.map((m) => [m.sectionId, m.section])).values()];

  return (
    <>
      <PageHeader
        title="My timetable"
        subtitle={
          <Link href={`/timetable-print/teacher/${teacher.id}`} className="text-brand-700 hover:underline">
            Printable view
          </Link>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Periods per week" value={weekly} />
        <StatCard label={day === today ? "Classes today" : "Classes that day"} value={periods.filter((p) => p.status !== "CANCELLED" && p.status !== "SUBSTITUTED").length} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title={`${day === today ? "Today" : formatDateKey(day)}`} className="xl:col-span-1">
          <form method="get" className="mb-3 flex gap-2">
            <input type="date" name="date" defaultValue={day} className={inputClass} aria-label="Date" />
            <button className="rounded-md bg-slate-800 px-3 text-sm font-medium text-white">Show</button>
          </form>
          <DayList
            periods={periods}
            show="section"
            nowMinutes={day === today ? minutesOfDay(now) : undefined}
            actions={(p) =>
              day >= today && p.slotId && p.status === "SCHEDULED" && p.teacherName === user.name ? (
                <ActionButton
                  action={markPeriodChange}
                  fields={{ sectionId: p.sectionId, dateKey: day, type: "CANCELLED", slotId: p.slotId }}
                  label="Cancel"
                  tone="danger"
                  confirmText="Cancel this period? Students will be notified."
                />
              ) : null
            }
          />
          {weekdayOf(day) === 7 && <p className="mt-2 text-xs text-slate-500">Sunday.</p>}
        </Card>

        <Card title="Week (current version)" className="xl:col-span-2">
          <WeekGrid timings={timings} slots={mySlots} todayDow={weekdayOf(today)} show="section" />
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title="Add an extra class">
          <ActionForm action={markPeriodChange} submitLabel="Add extra class" resetOnSuccess>
            <input type="hidden" name="type" value="EXTRA" />
            <FieldGrid>
              <Field label="Section" name="sectionId">
                <Select name="sectionId" options={sections.map((s) => ({ value: s.id, label: `${s.department.code} ${s.year}-${s.name}` }))} />
              </Field>
              <Field label="Subject" name="subjectId">
                <Select name="subjectId" options={mappings.map((m) => ({ value: m.subjectId, label: `${m.subject.code} (${m.section.department.code} ${m.section.year}-${m.section.name})` }))} />
              </Field>
              <Field label="Date" name="dateKey">
                <Input name="dateKey" type="date" defaultValue={today} min={today} />
              </Field>
              <Field label="Period" name="periodNumber">
                <Select name="periodNumber" options={gridRows(timings).map((n) => ({ value: String(n), label: `P${n}` }))} />
              </Field>
            </FieldGrid>
            <Field label="Note for students" name="note">
              <Input name="note" placeholder="Revision before Internal 1" />
            </Field>
          </ActionForm>
        </Card>

        <Card title="Changes I made">
          {myChanges.length === 0 ? (
            <EmptyState>No upcoming changes.</EmptyState>
          ) : (
            <Table head={["Date", "Section", "Change", ""]}>
              {myChanges.map((c) => (
                <tr key={c.id}>
                  <td className={`${td} text-xs`}>
                    {formatDateKey(c.dateKey)} · P{c.periodNumber}
                  </td>
                  <td className={td}>
                    {c.section.department.code} {c.section.year}-{c.section.name}
                  </td>
                  <td className={td}>
                    <Badge tone={c.type === "CANCELLED" ? "red" : "green"}>{c.type}</Badge> {c.subject?.code}
                  </td>
                  <td className={`${td} text-right`}>
                    <ActionButton action={removePeriodChange} fields={{ id: c.id }} label="Undo" />
                  </td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-3 text-xs text-slate-500">Substitutions are arranged by your HOD.</p>
        </Card>
      </div>
    </>
  );
}
