import Link from "next/link";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { attendanceFor, classesNeeded, riskLevel, type Outcome, type Risk } from "@/lib/attendance";
import { WEEKDAY_SHORT, formatDateKey, formatMonthKey, isMonthKey, monthWeeks, shiftMonth, toDateKey } from "@/lib/dates";
import { Badge, Card, EmptyState, StatCard, Table, td } from "./ui";

// Attendance report for one student (FR-32). The caller checks that the
// viewer may see this student (the student, their coordinator/HOD, parent).

const RISK_BADGE: Record<Risk, React.ReactNode> = {
  CRITICAL: <Badge tone="red">Critical</Badge>,
  WARNING: <Badge tone="amber">Below requirement</Badge>,
  OK: <Badge tone="green">OK</Badge>,
  NONE: <Badge>No classes yet</Badge>,
};
const OUTCOME_LABEL: Record<Outcome, string> = {
  ATTENDED: "Attended",
  ABSENT: "Absent",
  LEAVE: "Leave",
  NO_PUNCH: "Marked present, no campus punch",
};
const STATUS_LABEL: Record<string, string> = { PRESENT: "Present", LATE: "Late", ABSENT: "Absent", ON_LEAVE: "On leave", MEDICAL: "Medical" };

export async function AttendanceReport({ studentId, month, basePath }: { studentId: string; month?: string; basePath: string }) {
  const today = toDateKey(new Date());
  const [settings, ay] = await Promise.all([getSettings(), db.academicYear.findFirst({ where: { isCurrent: true } })]);
  const from = ay ? ay.startDate.toISOString().slice(0, 10) : undefined;
  const data = (await attendanceFor([studentId], { from, to: today })).get(studentId)!;
  const { overall } = data;
  const risk = riskLevel(overall.percent, settings);
  const need = classesNeeded(overall, settings.warningThreshold);
  const monthKey = isMonthKey(month) ? month : today.slice(0, 7);
  const sep = basePath.includes("?") ? "&" : "?";

  return (
    <div className="space-y-6">
      {risk === "CRITICAL" || risk === "WARNING" ? (
        <div className={`rounded-lg p-4 text-sm ${risk === "CRITICAL" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}>
          <p className="font-semibold">
            Attendance is {overall.percent}%, below the required {settings.warningThreshold}%.
          </p>
          <p>
            Attending the next {need} class{need === 1 ? "" : "es"} without a break brings it back to {settings.warningThreshold}%.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Overall" value={overall.percent === null ? "–" : `${overall.percent}%`} hint={`Required ${settings.warningThreshold}%`} />
        <StatCard label="Classes held" value={overall.held} />
        <StatCard label="Attended" value={overall.attended} hint="Present or late" />
        <StatCard label="Absent" value={overall.absent + overall.noPunch} hint={overall.noPunch ? `${overall.noPunch} without campus punch` : undefined} />
        <StatCard label="Leave" value={overall.leave} hint={settings.leavePolicy === "COUNT_AS_PRESENT" ? "Counted as present" : "Not counted"} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="By subject">
          {data.bySubject.length === 0 ? (
            <EmptyState>No attendance recorded yet.</EmptyState>
          ) : (
            <Table head={["Subject", "Held", "Attended", "%", ""]}>
              {data.bySubject.map((s) => (
                <tr key={s.subjectId}>
                  <td className={td}>
                    <span className="font-mono text-xs text-slate-500">{s.code}</span> {s.name}
                  </td>
                  <td className={`${td} tabular-nums`}>{s.held}</td>
                  <td className={`${td} tabular-nums`}>{s.attended}</td>
                  <td className={`${td} tabular-nums font-medium`}>{s.percent === null ? "–" : `${s.percent}%`}</td>
                  <td className={td}>{RISK_BADGE[riskLevel(s.percent, settings)]}</td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-3 text-xs text-slate-500">Overall status: {RISK_BADGE[risk]}</p>
        </Card>

        <Card title={formatMonthKey(monthKey)} action={
          <div className="flex gap-2 text-xs">
            <Link href={`${basePath}${sep}month=${shiftMonth(monthKey, -1)}`} className="text-brand-700 hover:underline">← Prev</Link>
            <Link href={`${basePath}${sep}month=${shiftMonth(monthKey, 1)}`} className="text-brand-700 hover:underline">Next →</Link>
          </div>
        }>
          <div className="grid grid-cols-7 gap-1 text-center text-xs">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <span key={d} className="py-1 font-medium text-slate-500">{WEEKDAY_SHORT[d]}</span>
            ))}
            {monthWeeks(monthKey).flat().map((day, i) => {
              if (!day) return <span key={i} />;
              const t = data.byDate.get(day);
              const tone = !t || t.held === 0 ? "bg-slate-50 text-slate-400" : t.attended === t.held ? "bg-emerald-100 text-emerald-900" : t.attended === 0 ? "bg-red-100 text-red-900" : "bg-amber-100 text-amber-900";
              return (
                <span key={day} className={`rounded py-1.5 ${tone} ${day === today ? "ring-2 ring-brand-600" : ""}`} title={t ? `${t.attended}/${t.held} classes` : "No classes recorded"}>
                  <span className="block font-medium">{Number(day.slice(8))}</span>
                  <span className="block text-[10px]">{t && t.held ? `${t.attended}/${t.held}` : ""}</span>
                </span>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-slate-500">Green: all classes attended · Amber: some missed · Red: all missed</p>
        </Card>
      </div>

      <Card title="Recent classes">
        {data.records.length === 0 ? (
          <EmptyState>No classes recorded yet.</EmptyState>
        ) : (
          <Table head={["Date", "Period", "Subject", "Marked", "Counts as"]}>
            {data.records.slice(0, 20).map((r, i) => (
              <tr key={i}>
                <td className={`${td} whitespace-nowrap text-xs`}>{formatDateKey(r.dateKey)}</td>
                <td className={td}>P{r.periodNumber}</td>
                <td className={td}>{r.subject}</td>
                <td className={td}>{STATUS_LABEL[r.status]}</td>
                <td className={td}>
                  <Badge tone={r.outcome === "ATTENDED" ? "green" : r.outcome === "LEAVE" ? "brand" : r.outcome === "NO_PUNCH" ? "amber" : "red"}>
                    {OUTCOME_LABEL[r.outcome]}
                  </Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
        {settings.requireCampusPunch && (
          <p className="mt-3 text-xs text-slate-500">
            A class marked present counts only on days with a campus punch. A missed punch can be fixed with a regularisation request.
          </p>
        )}
      </Card>
    </div>
  );
}
