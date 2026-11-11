import "server-only";
import { db } from "./db";
import { getSettings } from "./settings";
import { attendanceFor, riskLevel, type Risk } from "./attendance";
import { addDays, toDateKey } from "./dates";

// Admin / HOD dashboards (FR-29): day-wise attendance, defaulters,
// department and year comparison, punch exceptions. departmentIds = null
// means the whole college.

export type DayPoint = { dateKey: string; held: number; attended: number; percent: number | null; onCampus: number };
export type GroupRow = { departmentCode: string; year: number; students: number; average: number | null; warning: number; critical: number };
export type Defaulter = { studentId: string; userId: string; name: string; rollNo: string; className: string; percent: number | null; held: number; risk: Risk };

export async function analytics(departmentIds: string[] | null, days = 30) {
  const settings = await getSettings();
  const today = toDateKey(new Date());
  const from = addDays(today, -(days - 1));
  const ay = await db.academicYear.findFirst({ where: { isCurrent: true } });
  const deptFilter = departmentIds ? { departmentId: { in: departmentIds } } : {};

  const students = await db.student.findMany({
    where: { status: "ACTIVE", ...deptFilter },
    include: { user: { select: { name: true } }, section: true, department: true },
    orderBy: { rollNo: "asc" },
  });
  const ids = students.map((s) => s.id);
  const [year, recent, campus, rejected, flagged] = await Promise.all([
    attendanceFor(ids, { from: ay?.startDate.toISOString().slice(0, 10), to: today }),
    attendanceFor(ids, { from, to: today }),
    db.campusSession.groupBy({ by: ["dateKey"], where: { dateKey: { gte: from }, student: { status: "ACTIVE", ...deptFilter } }, _count: true }),
    db.punchRecord.groupBy({ by: ["reason"], where: { status: "REJECTED", dateKey: { gte: addDays(today, -6) }, student: deptFilter }, _count: true }),
    db.punchRecord.count({ where: { flags: { not: null }, dateKey: { gte: addDays(today, -6) }, student: deptFilter } }),
  ]);

  // Day-wise class attendance across all students in scope.
  const daily: DayPoint[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    let held = 0;
    let attended = 0;
    for (const s of recent.values()) {
      const t = s.byDate.get(d);
      if (t) {
        held += t.held;
        attended += t.attended;
      }
    }
    daily.push({ dateKey: d, held, attended, percent: held ? Math.round((attended / held) * 1000) / 10 : null, onCampus: campus.find((c) => c.dateKey === d)?._count ?? 0 });
  }

  const groups = new Map<string, GroupRow & { sum: number; withData: number }>();
  const defaulters: Defaulter[] = [];
  for (const s of students) {
    const t = year.get(s.id)!.overall;
    const risk = riskLevel(t.percent, settings);
    const key = `${s.department.code}:${s.year}`;
    if (!groups.has(key)) groups.set(key, { departmentCode: s.department.code, year: s.year, students: 0, average: null, warning: 0, critical: 0, sum: 0, withData: 0 });
    const g = groups.get(key)!;
    g.students++;
    if (t.percent !== null) {
      g.sum += t.percent;
      g.withData++;
    }
    if (risk === "WARNING") g.warning++;
    if (risk === "CRITICAL") g.critical++;
    if (risk === "WARNING" || risk === "CRITICAL") {
      defaulters.push({
        studentId: s.id,
        userId: s.userId,
        name: s.user.name,
        rollNo: s.rollNo,
        className: `${s.department.code} ${s.year}-${s.section.name}`,
        percent: t.percent,
        held: t.held,
        risk,
      });
    }
  }
  const comparison = [...groups.values()]
    .map(({ sum, withData, ...g }) => ({ ...g, average: withData ? Math.round((sum / withData) * 10) / 10 : null }))
    .sort((a, b) => a.departmentCode.localeCompare(b.departmentCode) || a.year - b.year);
  defaulters.sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0));

  return {
    settings,
    daily,
    comparison,
    defaulters,
    exceptions: rejected.map((r) => ({ reason: r.reason ?? "UNKNOWN", count: r._count })).sort((a, b) => b.count - a.count),
    flagged,
    students: students.length,
  };
}
