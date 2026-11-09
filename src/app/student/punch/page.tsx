import type { Metadata } from "next";
import Link from "next/link";
import { requireStudent } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { getDayStatus } from "@/lib/calendar";
import { formatDateKey, formatTime, toDateKey } from "@/lib/dates";
import { formatDateTime } from "@/lib/config";
import { Badge, Card, EmptyState, PageHeader, Table, td } from "@/components/ui";
import { PunchClient } from "./punch-client";

export const metadata: Metadata = { title: "Punch in / out" };

const SESSION_TONES = { OPEN: "brand", COMPLETE: "green", INCOMPLETE: "amber", REGULARISED: "slate" } as const;

export default async function PunchPage() {
  const { student } = await requireStudent();
  const today = toDateKey(new Date());

  const [settings, day, sessions, recent, fences] = await Promise.all([
    getSettings(),
    getDayStatus(today, { departmentId: student.departmentId, year: student.year }),
    db.campusSession.findMany({ where: { studentId: student.id }, orderBy: { inAt: "desc" }, take: 7 }),
    db.punchRecord.findMany({ where: { studentId: student.id }, orderBy: { serverTime: "desc" }, take: 8 }),
    db.geofence.count({ where: { isActive: true } }),
  ]);

  const todays = sessions.filter((s) => s.dateKey === today);
  const open = todays.find((s) => s.status === "OPEN");
  const nextAction = open ? "OUT" : todays.length > 0 && !settings.allowMultipleSessions ? "DONE" : "IN";

  return (
    <>
      <PageHeader title="Punch in / out" subtitle={formatDateKey(today)} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          {settings.enforceSchedule && !day.working && (
            <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Today is not a working day ({day.reason}). Punching is closed.
            </p>
          )}
          {fences === 0 && (
            <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              The campus location has not been set up yet.
            </p>
          )}
          <PunchClient nextAction={nextAction} maxAccuracy={settings.maxAccuracyMeters} />
        </Card>

        <Card title="Today">
          {todays.length === 0 ? (
            <EmptyState>No punch yet today.</EmptyState>
          ) : (
            <ul className="space-y-2 text-sm">
              {todays.map((s) => (
                <li key={s.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
                  <span>
                    In {formatTime(s.inAt)} · Out {s.outAt ? formatTime(s.outAt) : "–"}
                    {s.minutesOnCampus != null && (
                      <span className="text-slate-500">
                        {" "}
                        ({Math.floor(s.minutesOnCampus / 60)} h {s.minutesOnCampus % 60} min)
                      </span>
                    )}
                  </span>
                  <Badge tone={SESSION_TONES[s.status]}>{s.status}</Badge>
                </li>
              ))}
            </ul>
          )}
          <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-800">Last 7 campus days</h3>
          <ul className="space-y-1 text-sm">
            {sessions.map((s) => (
              <li key={s.id} className="flex justify-between gap-2">
                <span>{formatDateKey(s.dateKey)}</span>
                <span className="text-slate-600">
                  {formatTime(s.inAt)}–{s.outAt ? formatTime(s.outAt) : "?"} <Badge tone={SESSION_TONES[s.status]}>{s.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
          {sessions.some((s) => s.status === "INCOMPLETE") && (
            <p className="mt-3 text-sm">
              Forgot to punch out or had a GPS problem?{" "}
              <Link href="/student/requests" className="text-brand-700 hover:underline">
                Request regularisation
              </Link>
            </p>
          )}
        </Card>
      </div>

      <Card title="Recent punch attempts" className="mt-6">
        {recent.length === 0 ? (
          <EmptyState>No punches yet.</EmptyState>
        ) : (
          <Table head={["When", "Type", "Result", "Distance", "Details"]}>
            {recent.map((p) => (
              <tr key={p.id}>
                <td className={`${td} whitespace-nowrap text-xs`}>{formatDateTime(p.effectiveTime)}</td>
                <td className={td}>{p.type === "IN" ? "In" : "Out"}</td>
                <td className={td}>
                  <Badge tone={p.status === "ACCEPTED" ? "green" : "red"}>{p.status === "ACCEPTED" ? "Accepted" : "Rejected"}</Badge>
                  {p.source === "OFFLINE" && <span className="ml-1 text-xs text-slate-500">offline</span>}
                </td>
                <td className={`${td} tabular-nums`}>{p.distanceMeters != null ? `${Math.round(p.distanceMeters)} m` : "–"}</td>
                <td className={`${td} text-xs text-slate-600`}>{p.message}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
