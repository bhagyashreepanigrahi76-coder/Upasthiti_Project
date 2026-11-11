import type { Metadata } from "next";
import { getTeacherProfile, requirePortal } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { CalendarView } from "@/components/calendar-view";

export const metadata: Metadata = { title: "Calendar" };

type Props = { searchParams: Promise<{ month?: string }> };

export default async function TeacherCalendarPage({ searchParams }: Props) {
  const user = await requirePortal("teacher");
  const teacher = await getTeacherProfile(user.id);
  const { month } = await searchParams;
  return (
    <>
      <PageHeader title="Academic calendar" subtitle="College-wide entries plus every year of your department." />
      <CalendarView scope={{ departmentId: teacher?.departmentId }} month={month} basePath="/teacher/calendar" />
    </>
  );
}
