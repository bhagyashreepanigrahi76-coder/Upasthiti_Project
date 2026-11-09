import type { Metadata } from "next";
import Link from "next/link";
import { requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatLongDate } from "@/lib/config";
import { formatTime, minutesOfDay, toDateKey } from "@/lib/dates";
import { sectionDay } from "@/lib/timetable";
import { Badge, Card, ComingSoon, EmptyState, PageHeader } from "@/components/ui";
import { DayList } from "@/components/timetable-views";

export const metadata: Metadata = { title: "Student dashboard" };

export default async function StudentDashboardPage() {
  const user = await requirePortal("student");

  // A student only ever sees their own record (PRD §6).
  const student = await db.student.findUnique({
    where: { userId: user.id },
    include: {
      department: true,
      section: true,
      mentor: { include: { user: { select: { name: true } } } },
      parents: { include: { parent: { select: { name: true, email: true } } } },
    },
  });

  if (!student) {
    return (
      <>
        <PageHeader title="Student dashboard" />
        <EmptyState>Your student profile has not been set up yet. Please contact the college office.</EmptyState>
      </>
    );
  }

  const now = new Date();
  const today = toDateKey(now);
  const [classes, todaysSessions, pendingLeave, pendingReg, plan] = await Promise.all([
    db.teacherSubject.findMany({
      where: { sectionId: student.sectionId },
      include: { subject: true, teacher: { include: { user: { select: { name: true } } } } },
      orderBy: { subject: { code: "asc" } },
    }),
    db.campusSession.findMany({ where: { studentId: student.id, dateKey: today } }),
    db.leaveRequest.count({ where: { studentId: student.id, status: "PENDING" } }),
    db.regularisationRequest.count({ where: { studentId: student.id, status: "PENDING" } }),
    sectionDay(student.sectionId, today, student.batchId),
  ]);
  const open = todaysSessions.find((s) => s.status === "OPEN");
  const pendingRequests = pendingLeave + pendingReg;

  const profile: [string, React.ReactNode][] = [
    ["Roll number", <span key="r" className="font-mono">{student.rollNo}</span>],
    ["Programme", student.department.programme],
    ["Year / Section", `Year ${student.year} · Section ${student.section.name}`],
    ["Class coordinator", student.mentor?.user.name ?? "Not assigned"],
    ["Parent contact", student.parents.map((p) => `${p.parent.name} (${p.parent.email})`).join(", ") || "None on file"],
  ];

  return (
    <>
      <PageHeader title={`Hi, ${user.name.split(" ")[0]}`} subtitle={formatLongDate(new Date())} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Campus attendance today" className="lg:col-span-1">
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            {open ? (
              <>
                <Badge tone="green">On campus since {formatTime(open.inAt)}</Badge>
                <p className="text-sm text-slate-600">Remember to punch out when you leave.</p>
              </>
            ) : todaysSessions.length > 0 ? (
              <Badge tone="slate">Done for today</Badge>
            ) : (
              <p className="text-sm text-slate-600">You have not punched in today.</p>
            )}
            <Link
              href="/student/punch"
              className="rounded-md bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              {open ? "Punch out" : "Open punch screen"}
            </Link>
            {pendingRequests > 0 && (
              <p className="text-xs text-slate-500">
                {pendingRequests} request{pendingRequests > 1 ? "s" : ""} waiting for approval
              </p>
            )}
          </div>
        </Card>

        <Card title="My profile" className="lg:col-span-2">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {profile.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
                <dd className="mt-0.5 text-sm text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <Card title={`My subjects · Semester ${classes[0]?.subject.semester ?? "–"}`} className="mt-6">
        {classes.length === 0 ? (
          <EmptyState>No subjects are mapped to your section yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3 font-medium">Code</th>
                  <th className="py-2 pr-3 font-medium">Subject</th>
                  <th className="py-2 pr-3 font-medium">Teacher</th>
                  <th className="py-2 font-medium">Type</th>
                </tr>
              </thead>
              <tbody>
                {classes.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs text-slate-600">{c.subject.code}</td>
                    <td className="py-2 pr-3 text-slate-900">{c.subject.name}</td>
                    <td className="py-2 pr-3 text-slate-600">{c.teacher.user.name}</td>
                    <td className="py-2">
                      <Badge tone={c.subject.type === "PRACTICAL" ? "amber" : "slate"}>
                        {c.subject.type === "PRACTICAL" ? "Practical" : "Theory"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Today's classes" className="mt-6" action={<Link href="/student/timetable" className="text-xs font-medium text-brand-700 hover:underline">Full timetable</Link>}>
        {plan.reason ? <EmptyState>{plan.reason}</EmptyState> : <DayList periods={plan.periods} nowMinutes={minutesOfDay(now)} />}
      </Card>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <ComingSoon day={6}>Attendance: overall, subject-wise and monthly calendar.</ComingSoon>
        <ComingSoon day={7}>Internal and semester results, PDF report card.</ComingSoon>
      </div>
    </>
  );
}
