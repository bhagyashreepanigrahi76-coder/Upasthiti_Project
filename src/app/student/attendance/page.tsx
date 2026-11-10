import type { Metadata } from "next";
import { requireStudent } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { AttendanceReport } from "@/components/attendance-report";

export const metadata: Metadata = { title: "My attendance" };

type Props = { searchParams: Promise<{ month?: string }> };

export default async function StudentAttendancePage({ searchParams }: Props) {
  const { student } = await requireStudent();
  const { month } = await searchParams;
  return (
    <>
      <PageHeader title="My attendance" subtitle="This academic year, from attendance marked by your teachers." />
      <AttendanceReport studentId={student.id} month={month} basePath="/student/attendance" />
    </>
  );
}
