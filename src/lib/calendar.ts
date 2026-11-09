import "server-only";
import type { CalendarEvent, Prisma } from "@prisma/client";
import { db } from "./db";
import { getSettings, type AppSettings } from "./settings";
import { weekdayOf } from "./dates";

// FR-13/FR-15/FR-62: whether a date is a working day for a student's
// department and year, based on the weekly pattern plus calendar entries.

export type CalendarScope = { departmentId?: string | null; year?: number | null };

/**
 * Events that apply to everyone, plus those for this department/year.
 * A missing departmentId or year means "don't filter on it" (e.g. a teacher
 * sees every year of their department; an admin sees everything).
 */
export function scopeWhere(scope?: CalendarScope): Prisma.CalendarEventWhereInput {
  if (!scope) return {};
  const and: Prisma.CalendarEventWhereInput[] = [];
  if (scope.departmentId) and.push({ OR: [{ departmentId: null }, { departmentId: scope.departmentId }] });
  if (scope.year) and.push({ OR: [{ year: null }, { year: scope.year }] });
  return and.length ? { AND: and } : {};
}

export function eventsInRange(from: string, to: string, scope?: CalendarScope) {
  return db.calendarEvent.findMany({
    where: { startDate: { lte: to }, endDate: { gte: from }, ...scopeWhere(scope) },
    orderBy: [{ startDate: "asc" }, { type: "asc" }],
    include: { department: { select: { code: true } } },
  });
}

export type DayStatus = {
  dateKey: string;
  working: boolean;
  reason: string | null;
  exam: boolean;
  events: CalendarEvent[];
};

/** Pure version: decide from already-loaded events (used by month views). */
export function dayStatusFrom(dateKey: string, allEvents: CalendarEvent[], settings: AppSettings): DayStatus {
  const events = allEvents.filter((e) => e.startDate <= dateKey && e.endDate >= dateKey);
  const holiday = events.find((e) => e.type === "HOLIDAY");
  const exam = events.some((e) => e.type === "EXAM");
  if (holiday) return { dateKey, working: false, reason: `Holiday: ${holiday.title}`, exam, events };

  const weekday = weekdayOf(dateKey);
  if (settings.workingDays.includes(weekday)) return { dateKey, working: true, reason: null, exam, events };
  if (weekday === 6 && events.some((e) => e.type === "WORKING_SATURDAY")) {
    return { dateKey, working: true, reason: null, exam, events };
  }
  return { dateKey, working: false, reason: weekday === 7 ? "Sunday" : "Not a working day", exam, events };
}

export async function getDayStatus(dateKey: string, scope?: CalendarScope): Promise<DayStatus> {
  const [settings, events] = await Promise.all([getSettings(), eventsInRange(dateKey, dateKey, scope)]);
  return dayStatusFrom(dateKey, events, settings);
}
