import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeacherProfile, requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { editWindowPassed, findPeriod, rosterFor } from "@/lib/class-attendance";
import { formatDateKey, isDateKey, toDateKey } from "@/lib/dates";
import { formatDateTime } from "@/lib/config";
import { Badge, Card, PageHeader } from "@/components/ui";
import { AttendanceSheet } from "@/components/attendance-sheet";

export const metadata: Metadata = { title: "Period attendance" };

type Props = { params: Promise<{ date: string; periodKey: string }> };

export default async function MarkPeriodPage({ params }: Props) {
  const user = await requirePortal("teacher");
  const { date, periodKey: rawKey } = await params;
  const periodKey = decodeURIComponent(rawKey);
  if (!isDateKey(date)) notFound();

  const [teacher, found, settings] = await Promise.all([getTeacherProfile(user.id), findPeriod(date, periodKey), getSettings()]);
  if (!found || !teacher || found.period.teacherId !== teacher.id) notFound();
  const { sectionId, period } = found;

  const [roster, session, campus, leaves] = await Promise.all([
    rosterFor(sectionId, period.batchId),
    db.classSession.findUnique({
      where: { dateKey_periodKey: { dateKey: date, periodKey } },
      include: { records: true, editRequests: { where: { status: "PENDING" } } },
    }),
    db.campusSession.findMany({ where: { dateKey: date, student: { sectionId } }, select: { studentId: true } }),
    db.leaveRequest.findMany({
      where: { status: "APPROVED", fromDate: { lte: date }, toDate: { gte: date }, student: { sectionId } },
      select: { studentId: true },
    }),
  ]);
  const onCampus = new Set(campus.map((c) => c.studentId));
  const onLeave = new Set(leaves.map((l) => l.studentId));
  const locked = session ? editWindowPassed(session.takenAt, settings.attendanceEditHours) : false;

  return (
    <>
      <PageHeader
        title={`${period.sectionLabel} · ${period.subject}`}
        subtitle={
          <>
            {formatDateKey(date)} · Period {period.periodNumber} ({period.start}–{period.end})
            {period.batchName && ` · ${period.batchName}`} ·{" "}
            <Link href={`/teacher/attendance?date=${date}`} className="text-brand-700 hover:underline">
              Back
            </Link>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          {date === toDateKey(new Date()) && (
            <Link
              href={`/teacher/attendance/${date}/${encodeURIComponent(periodKey)}/qr`}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Show QR code
            </Link>
          )}
          {session ? <Badge tone="green">Taken {formatDateTime(session.takenAt)}</Badge> : <Badge tone="amber">Not taken yet</Badge>}
        </div>
      </PageHeader>

      {session && session.editRequests.length > 0 && (
        <p className="mb-4 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-800">An edit request is waiting for the HOD. You can&apos;t send another until it is decided.</p>
      )}
      {locked && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This attendance is older than {settings.attendanceEditHours} hours. Changes go to the HOD for approval.
        </p>
      )}

      <Card>
        <AttendanceSheet
          dateKey={date}
          periodKey={periodKey}
          needsReason={locked}
          requireCampusPunch={settings.requireCampusPunch}
          rows={roster.map((s) => ({
            id: s.id,
            name: s.user.name,
            rollNo: s.rollNo,
            // In an existing session, a student with no record has not scanned the QR, so starts as Absent.
            status: session?.records.find((r) => r.studentId === s.id)?.status ?? (onLeave.has(s.id) ? "ON_LEAVE" : session ? "ABSENT" : "PRESENT"),
            hasCampusDay: onCampus.has(s.id),
            onApprovedLeave: onLeave.has(s.id),
          }))}
        />
      </Card>
    </>
  );
}
