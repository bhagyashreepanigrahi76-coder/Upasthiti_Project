import "server-only";
import { db } from "./db";
import { sectionDay, type ScheduledPeriod } from "./timetable";

// Resolving a scheduled period and its roster for attendance marking (FR-61).

/** The section and the live (not cancelled) period for a date + periodKey, or null. */
export async function findPeriod(dateKey: string, periodKey: string): Promise<{ sectionId: string; period: ScheduledPeriod } | null> {
  let sectionId: string | null = null;
  if (periodKey.startsWith("x:")) {
    const change = await db.periodChange.findUnique({ where: { id: periodKey.slice(2) } });
    if (!change || change.type !== "EXTRA" || change.dateKey !== dateKey) return null;
    sectionId = change.sectionId;
  } else {
    const slot = await db.timetableSlot.findUnique({ where: { id: periodKey }, include: { timetable: true } });
    sectionId = slot?.timetable.sectionId ?? null;
  }
  if (!sectionId) return null;
  // Only periods that exist in the timetable in force that day, and are not cancelled.
  const day = await sectionDay(sectionId, dateKey);
  const period = day.periods.find((p) => p.periodKey === periodKey && p.status !== "CANCELLED");
  return period ? { sectionId, period } : null;
}

/** Active students who attend this period: the section, or only its lab batch. */
export function rosterFor(sectionId: string, batchId: string | null) {
  return db.student.findMany({
    where: { sectionId, status: "ACTIVE", ...(batchId ? { batchId } : {}) },
    orderBy: { rollNo: "asc" },
    include: { user: { select: { name: true } } },
  });
}

/** FR-20: has the direct-edit window for this attendance passed? */
export function editWindowPassed(takenAt: Date, hours: number, now = new Date()): boolean {
  return now.getTime() - takenAt.getTime() > hours * 3_600_000;
}
