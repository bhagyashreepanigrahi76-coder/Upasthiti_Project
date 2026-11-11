import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canApproveForStudent, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateKey, toDateKey } from "@/lib/dates";
import { COLLEGE_NAME } from "@/lib/config";
import { ResultsView } from "@/components/results-view";
import { PrintButton } from "@/components/print-button";
import { Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Report card" };

type Props = { params: Promise<{ studentId: string }> };

// FR-33 report card: print or "Save as PDF" from the browser.
export default function ReportCardPage({ params }: Props) {
  return (
    <div className="mx-auto max-w-4xl bg-white p-6 print:p-0">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <ReportCard params={params} />
      </Suspense>
    </div>
  );
}

async function ReportCard({ params }: Props) {
  const user = await requireUser();
  const { studentId } = await params;
  const student = await db.student.findUnique({
    where: { id: studentId },
    include: { user: { select: { name: true } }, department: true, section: true, parents: { select: { parent: { select: { userId: true } } } } },
  });
  if (!student) notFound();
  // The student, their parents, their coordinator/HOD, or an admin.
  const allowed =
    student.userId === user.id ||
    student.parents.some((p) => p.parent.userId === user.id) ||
    user.roles.includes("ADMIN") ||
    (await canApproveForStudent(user, student));
  if (!allowed) notFound();

  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <p className="text-sm text-slate-500">{COLLEGE_NAME}</p>
          <h1 className="text-xl font-semibold text-slate-900">Report card</h1>
          <p className="mt-1 text-sm text-slate-700">
            {student.user.name} · <span className="font-mono">{student.rollNo}</span> · {student.department.programme} · Year {student.year}-{student.section.name}
          </p>
          <p className="text-xs text-slate-500">Generated {formatDateKey(toDateKey(new Date()))}. Contains published results only.</p>
        </div>
        <PrintButton />
      </div>
      <ResultsView studentId={student.id} />
    </>
  );
}
