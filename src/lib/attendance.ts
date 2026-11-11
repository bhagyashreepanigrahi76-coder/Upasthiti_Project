import "server-only";
import type { AttendanceStatus } from "@prisma/client";
import { db } from "./db";
import { getSettings, type AppSettings } from "./settings";

// Attendance percentage engine (PRD §6):
//   % = (classes attended + approved-leave classes if counted) / (classes held) × 100
// "Classes held" are periods where attendance was actually taken, so holidays,
// exam days and cancelled periods never count (FR-15, FR-62, FR-63).
// Late counts as attended. When requireCampusPunch is on, Present/Late only
// counts if the student was on campus that day (§4.3); a later approved
// regularisation fixes this automatically because nothing is stored twice.

export type Outcome = "ATTENDED" | "ABSENT" | "LEAVE" | "NO_PUNCH";

export function classify(status: AttendanceStatus, hasCampusDay: boolean, onApprovedLeave: boolean, requirePunch: boolean): Outcome {
  if (status === "ON_LEAVE" || status === "MEDICAL") return "LEAVE";
  if (status === "ABSENT") return onApprovedLeave ? "LEAVE" : "ABSENT";
  if (requirePunch && !hasCampusDay) return onApprovedLeave ? "LEAVE" : "NO_PUNCH";
  return "ATTENDED";
}

export type Tally = { held: number; attended: number; leave: number; absent: number; noPunch: number; percent: number | null };
const emptyTally = (): Tally => ({ held: 0, attended: 0, leave: 0, absent: 0, noPunch: 0, percent: null });

function add(t: Tally, outcome: Outcome, leavePolicy: AppSettings["leavePolicy"]) {
  if (outcome === "LEAVE") {
    t.leave++;
    if (leavePolicy === "COUNT_AS_PRESENT") {
      t.held++;
      t.attended++;
    }
  } else {
    t.held++;
    if (outcome === "ATTENDED") t.attended++;
    else if (outcome === "ABSENT") t.absent++;
    else t.noPunch++;
  }
}
const finish = (t: Tally) => {
  t.percent = t.held ? Math.round((t.attended / t.held) * 1000) / 10 : null;
  return t;
};

export type RecordView = {
  dateKey: string;
  periodNumber: number;
  subject: string;
  status: AttendanceStatus;
  outcome: Outcome;
};

export type StudentAttendance = {
  overall: Tally;
  bySubject: (Tally & { subjectId: string; code: string; name: string })[];
  byDate: Map<string, Tally>;
  records: RecordView[];
};

/** Attendance for many students at once, optionally limited to a date range. */
export async function attendanceFor(studentIds: string[], range: { from?: string; to?: string } = {}): Promise<Map<string, StudentAttendance>> {
  const settings = await getSettings();
  const dateFilter = { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) };
  const [records, campus, leaves] = await Promise.all([
    db.attendanceRecord.findMany({
      where: { studentId: { in: studentIds }, session: { dateKey: dateFilter } },
      include: { session: { include: { subject: true } } },
      orderBy: [{ session: { dateKey: "desc" } }, { session: { periodNumber: "desc" } }],
    }),
    db.campusSession.findMany({
      where: { studentId: { in: studentIds }, dateKey: dateFilter },
      select: { studentId: true, dateKey: true },
    }),
    db.leaveRequest.findMany({
      where: {
        studentId: { in: studentIds },
        status: "APPROVED",
        ...(range.to ? { fromDate: { lte: range.to } } : {}),
        ...(range.from ? { toDate: { gte: range.from } } : {}),
      },
      select: { studentId: true, fromDate: true, toDate: true },
    }),
  ]);
  const campusDays = new Set(campus.map((c) => `${c.studentId}:${c.dateKey}`));
  const onLeave = (sid: string, d: string) => leaves.some((l) => l.studentId === sid && l.fromDate <= d && l.toDate >= d);

  const out = new Map<string, StudentAttendance>();
  for (const id of studentIds) out.set(id, { overall: emptyTally(), bySubject: [], byDate: new Map(), records: [] });

  for (const r of records) {
    const s = out.get(r.studentId)!;
    const d = r.session.dateKey;
    const outcome = classify(r.status, campusDays.has(`${r.studentId}:${d}`), onLeave(r.studentId, d), settings.requireCampusPunch);
    add(s.overall, outcome, settings.leavePolicy);
    const subjectId = r.session.subjectId ?? "none";
    let subj = s.bySubject.find((x) => x.subjectId === subjectId);
    if (!subj) {
      subj = { ...emptyTally(), subjectId, code: r.session.subject?.code ?? "–", name: r.session.subject?.name ?? "Class" };
      s.bySubject.push(subj);
    }
    add(subj, outcome, settings.leavePolicy);
    if (!s.byDate.has(d)) s.byDate.set(d, emptyTally());
    add(s.byDate.get(d)!, outcome, settings.leavePolicy);
    s.records.push({ dateKey: d, periodNumber: r.session.periodNumber, subject: r.session.subject?.code ?? "Class", status: r.status, outcome });
  }
  for (const s of out.values()) {
    finish(s.overall);
    s.bySubject.forEach(finish);
    s.bySubject.sort((a, b) => a.code.localeCompare(b.code));
    s.byDate.forEach(finish);
  }
  return out;
}

export type Risk = "CRITICAL" | "WARNING" | "OK" | "NONE";

/** Warning ladder (FR-41): below the warning level, then below the critical level. */
export function riskLevel(percent: number | null, settings: AppSettings): Risk {
  if (percent === null) return "NONE";
  if (percent < settings.criticalThreshold) return "CRITICAL";
  if (percent < settings.warningThreshold) return "WARNING";
  return "OK";
}

/** Classes in a row a student must attend to reach the target percentage. */
export function classesNeeded(t: Tally, target: number): number {
  if (t.held === 0 || (t.percent ?? 0) >= target) return 0;
  return Math.ceil((target * t.held - 100 * t.attended) / (100 - target));
}
