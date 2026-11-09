import type { Metadata } from "next";
import { requireStudent } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { CalendarView } from "@/components/calendar-view";

export const metadata: Metadata = { title: "Calendar" };

type Props = { searchParams: Promise<{ month?: string }> };

export default async function StudentCalendarPage({ searchParams }: Props) {
  const { student } = await requireStudent();
  const { month } = await searchParams;
  return (
    <>
      <PageHeader title="Academic calendar" subtitle={`Holidays, exams and events for ${student.department.code} Year ${student.year}`} />
      <CalendarView scope={{ departmentId: student.departmentId, year: student.year }} month={month} basePath="/student/calendar" />
    </>
  );
}
