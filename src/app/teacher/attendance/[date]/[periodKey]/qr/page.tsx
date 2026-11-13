import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeacherProfile, requirePortal } from "@/lib/auth";
import { findPeriod } from "@/lib/class-attendance";
import { formatDateKey, isDateKey, toDateKey } from "@/lib/dates";
import { Card, PageHeader } from "@/components/ui";
import { QrDisplay } from "@/components/qr-display";

export const metadata: Metadata = { title: "Attendance QR" };

type Props = { params: Promise<{ date: string; periodKey: string }> };

export default async function AttendanceQrPage({ params }: Props) {
  const user = await requirePortal("teacher");
  const { date, periodKey: rawKey } = await params;
  const periodKey = decodeURIComponent(rawKey);
  if (!isDateKey(date)) notFound();

  const [teacher, found] = await Promise.all([getTeacherProfile(user.id), findPeriod(date, periodKey)]);
  if (!found || !teacher || found.period.teacherId !== teacher.id) notFound();
  const { period } = found;
  const back = `/teacher/attendance/${date}/${encodeURIComponent(periodKey)}`;

  return (
    <>
      <PageHeader
        title={`Attendance QR · ${period.sectionLabel} · ${period.subject}`}
        subtitle={
          <>
            {formatDateKey(date)} · Period {period.periodNumber} ({period.start}–{period.end}) ·{" "}
            <Link href={back} className="text-brand-700 hover:underline">
              Back to the attendance list
            </Link>
          </>
        }
      />
      <Card>
        {date === toDateKey(new Date()) ? (
          <QrDisplay dateKey={date} periodKey={periodKey} />
        ) : (
          <p className="text-sm text-slate-600">The QR code works only on the day of the class.</p>
        )}
      </Card>
      <p className="mt-4 text-sm text-slate-600">
        After the class, open the attendance list, mark anyone who did not scan as Absent, and press Save. Students who scanned already show as Present.
      </p>
    </>
  );
}
