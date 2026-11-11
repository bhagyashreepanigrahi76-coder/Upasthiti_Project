import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canApproveForStudent, requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { AttendanceReport } from "@/components/attendance-report";

export const metadata: Metadata = { title: "Student attendance" };

type Props = { params: Promise<{ studentId: string }>; searchParams: Promise<{ month?: string }> };

export default async function MenteeAttendancePage({ params, searchParams }: Props) {
  const user = await requirePortal("teacher");
  const [{ studentId }, { month }] = await Promise.all([params, searchParams]);
  const student = await db.student.findUnique({
    where: { id: studentId },
    include: { user: { select: { name: true } }, section: true, department: true, parents: { include: { parent: true } } },
  });
  // Only the student's class coordinator or HOD.
  if (!student || !(await canApproveForStudent(user, student))) notFound();
  return (
    <>
      <PageHeader
        title={student.user.name}
        subtitle={
          <>
            {student.rollNo} · {student.department.code} Year {student.year}-{student.section.name} · Parent:{" "}
            {student.parents.map((p) => `${p.parent.name} (${p.parent.email}${p.parent.phone ? `, ${p.parent.phone}` : ""})`).join("; ") || "none"} ·{" "}
            <Link href="/teacher/mentees" className="text-brand-700 hover:underline">All mentees</Link>
          </>
        }
      />
      <AttendanceReport studentId={student.id} month={month} basePath={`/teacher/mentees/${student.id}`} />
    </>
  );
}
