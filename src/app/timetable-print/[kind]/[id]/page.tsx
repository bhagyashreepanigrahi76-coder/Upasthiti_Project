import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { departmentsFor, getTeacherProfile, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateKey, toDateKey } from "@/lib/dates";
import { effectiveTimetable, effectiveTimetables, getTimings } from "@/lib/timetable";
import { COLLEGE_NAME } from "@/lib/config";
import { WeekGrid, type GridSlot } from "@/components/timetable-views";
import { PrintButton } from "@/components/print-button";
import { Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Timetable (print)" };

type Props = { params: Promise<{ kind: string; id: string }> };

// FR-65: printable section or teacher timetable ("Save as PDF" in the print dialog).
export default function PrintTimetablePage({ params }: Props) {
  return (
    <div className="mx-auto max-w-5xl bg-white p-6 print:p-0">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <PrintBody params={params} />
      </Suspense>
    </div>
  );
}

async function PrintBody({ params }: Props) {
  const user = await requireUser();
  const { kind, id } = await params;
  const today = toDateKey(new Date());
  const timings = await getTimings();

  let title: string;
  let slots: GridSlot[];
  let since: string | null = null;

  if (kind === "section") {
    const section = await db.section.findUnique({ where: { id }, include: { department: true } });
    if (!section) notFound();
    // Who may view: admin, the department's HOD, any teacher, the section's students, their parents.
    const own = await db.student.findFirst({
      where: { sectionId: id, OR: [{ userId: user.id }, { parents: { some: { parent: { userId: user.id } } } }] },
      select: { id: true },
    });
    const allowed =
      user.roles.includes("ADMIN") ||
      user.roles.includes("TEACHER") ||
      departmentsFor(user, "HOD").includes(section.departmentId) ||
      Boolean(own);
    if (!allowed) notFound();
    const tt = await effectiveTimetable(id, today);
    title = `${section.department.programme} · Year ${section.year} · Section ${section.name}`;
    slots = tt?.slots ?? [];
    since = tt?.effectiveFrom ?? null;
  } else if (kind === "teacher") {
    const teacher = await db.teacher.findUnique({ where: { id }, include: { user: { select: { name: true } } } });
    if (!teacher) notFound();
    const mine = await getTeacherProfile(user.id);
    const allowed = mine?.id === id || user.roles.includes("ADMIN") || departmentsFor(user, "HOD").includes(teacher.departmentId);
    if (!allowed) notFound();
    title = `Teacher timetable · ${teacher.user.name}`;
    slots = (await effectiveTimetables(today)).flatMap((tt) =>
      tt.slots
        .filter((s) => s.teacherId === id)
        .map((s) => ({ ...s, sectionLabel: `${tt.section.department.code} ${tt.section.year}-${tt.section.name}` })),
    );
  } else {
    notFound();
  }

  return (
    <>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">{COLLEGE_NAME}</p>
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          <p className="text-xs text-slate-500">
            {since ? `In force since ${formatDateKey(since)} · ` : ""}Printed {formatDateKey(today)}
          </p>
        </div>
        <PrintButton />
      </div>
      <WeekGrid timings={timings} slots={slots} show={kind === "teacher" ? "section" : "teacher"} />
    </>
  );
}
