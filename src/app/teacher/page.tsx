import type { Metadata } from "next";
import Link from "next/link";
import { requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatLongDate } from "@/lib/config";
import { minutesOfDay, toDateKey } from "@/lib/dates";
import { teacherDay } from "@/lib/timetable";
import { Badge, Card, EmptyState, PageHeader, StatCard } from "@/components/ui";
import { DayList } from "@/components/timetable-views";
import { DashboardNotices } from "@/components/notices-ui";

export const metadata: Metadata = { title: "Teacher dashboard" };

export default async function TeacherDashboardPage() {
  const user = await requirePortal("teacher");

  const teacher = await db.teacher.findUnique({
    where: { userId: user.id },
    include: {
      department: true,
      // Only classes assigned to this teacher (PRD §6).
      subjects: {
        include: { subject: true, section: true },
        orderBy: [{ section: { year: "asc" } }, { subject: { code: "asc" } }],
      },
      mentees: {
        where: { status: "ACTIVE" },
        orderBy: { rollNo: "asc" },
        include: { user: { select: { name: true } }, section: true },
      },
    },
  });

  if (!teacher) {
    return (
      <>
        <PageHeader title="Teacher dashboard" />
        <EmptyState>Your teacher profile has not been set up yet. Please contact the admin.</EmptyState>
      </>
    );
  }

  const isMentor = user.roles.includes("MENTOR");
  const sectionCount = new Set(teacher.subjects.map((s) => s.sectionId)).size;
  const now = new Date();
  const todays = await teacherDay(teacher.id, toDateKey(now));

  return (
    <>
      <PageHeader
        title={`Hello, ${user.name}`}
        subtitle={`${formatLongDate(new Date())} · ${teacher.department.programme}`}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Assigned classes" value={teacher.subjects.length} />
        <StatCard label="Sections" value={sectionCount} />
        <StatCard label="Mentees" value={isMentor ? teacher.mentees.length : "–"} />
        <StatCard label="Classes today" value={todays.filter((p) => p.status !== "CANCELLED" && p.status !== "SUBSTITUTED").length} />
      </div>

      <Card
        title="Today's classes"
        className="mt-6"
        action={
          <Link href="/teacher/timetable" className="text-xs font-medium text-brand-700 hover:underline">
            My timetable
          </Link>
        }
      >
        <DayList
          periods={todays}
          show="section"
          nowMinutes={minutesOfDay(now)}
          actions={(p) =>
            p.teacherId === teacher.id && p.status !== "CANCELLED" ? (
              <Link
                href={`/teacher/attendance/${toDateKey(now)}/${encodeURIComponent(p.periodKey)}`}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Attendance
              </Link>
            ) : null
          }
        />
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="My classes">
          {teacher.subjects.length === 0 ? (
            <EmptyState>No subjects are assigned to you yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {teacher.subjects.map((ts) => (
                <li key={ts.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {ts.subject.name}{" "}
                      <span className="font-mono text-xs text-slate-500">{ts.subject.code}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      Year {ts.section.year} · Section {ts.section.name} · Semester {ts.subject.semester}
                    </p>
                  </div>
                  <Badge tone={ts.subject.type === "PRACTICAL" ? "amber" : "slate"}>
                    {ts.subject.type === "PRACTICAL" ? "Practical" : "Theory"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {isMentor ? (
          <Card title="My mentees">
            {teacher.mentees.length === 0 ? (
              <EmptyState>No students are assigned to you as mentor.</EmptyState>
            ) : (
              <ul className="divide-y divide-slate-100">
                {teacher.mentees.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm text-slate-900">{s.user.name}</span>
                    <span className="text-xs text-slate-500">
                      <span className="font-mono">{s.rollNo}</span> · Y{s.year}-{s.section.name}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : (
          <div>
            <DashboardNotices user={user} />
          </div>
        )}
      </div>

      {isMentor && (
        <div className="mt-6">
          <DashboardNotices user={user} />
        </div>
      )}
    </>
  );
}
