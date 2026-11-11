import type { Metadata } from "next";
import Link from "next/link";
import { requireStudent } from "@/lib/auth";
import { formatDateKey, minutesOfDay, toDateKey, weekdayOf, addDays } from "@/lib/dates";
import { effectiveTimetable, getTimings, sectionDay } from "@/lib/timetable";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { DayList, WeekGrid } from "@/components/timetable-views";

export const metadata: Metadata = { title: "Timetable" };

export default async function StudentTimetablePage() {
  const { student } = await requireStudent();
  const now = new Date();
  const today = toDateKey(now);
  const tomorrow = addDays(today, 1);

  const [timings, tt, todayPlan, tomorrowPlan] = await Promise.all([
    getTimings(),
    effectiveTimetable(student.sectionId, today),
    sectionDay(student.sectionId, today, student.batchId),
    sectionDay(student.sectionId, tomorrow, student.batchId),
  ]);
  // Whole-section classes plus this student's own lab batch (FR-56).
  const slots = (tt?.slots ?? []).filter((s) => !s.batchId || s.batchId === student.batchId);

  return (
    <>
      <PageHeader
        title="Timetable"
        subtitle={
          <>
            {student.department.code} Year {student.year} · Section {student.section.name}
            {student.batch && ` · ${student.batch.name}`} ·{" "}
            <Link href={`/timetable-print/section/${student.sectionId}`} className="text-brand-700 hover:underline">
              Printable view
            </Link>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6">
          <Card title={`Today · ${formatDateKey(today)}`}>
            {todayPlan.reason ? <EmptyState>{todayPlan.reason}</EmptyState> : <DayList periods={todayPlan.periods} nowMinutes={minutesOfDay(now)} />}
          </Card>
          <Card title={`Tomorrow · ${formatDateKey(tomorrow)}`}>
            {tomorrowPlan.reason ? <EmptyState>{tomorrowPlan.reason}</EmptyState> : <DayList periods={tomorrowPlan.periods} />}
          </Card>
        </div>
        <Card title={tt ? `Week (in force since ${formatDateKey(tt.effectiveFrom)})` : "Week"} className="xl:col-span-2">
          {tt ? <WeekGrid timings={timings} slots={slots} todayDow={weekdayOf(today)} /> : <EmptyState>Your timetable has not been published yet.</EmptyState>}
        </Card>
      </div>
    </>
  );
}
