// Date helpers. All attendance logic works on "date keys" (YYYY-MM-DD) and
// minutes since midnight in the college time zone, never the server's.
import { TIME_ZONE } from "./config";

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function zoned(d: Date) {
  const p: Record<string, string> = {};
  for (const part of partsFmt.formatToParts(d)) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** YYYY-MM-DD of an instant, in the college time zone. */
export function toDateKey(d: Date): string {
  const z = zoned(d);
  return `${z.year}-${String(z.month).padStart(2, "0")}-${String(z.day).padStart(2, "0")}`;
}

/** Minutes since local midnight, in the college time zone. */
export function minutesOfDay(d: Date): number {
  const z = zoned(d);
  return z.hour * 60 + z.minute;
}

export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function keyToUtcNoon(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** 1 = Monday ... 7 = Sunday. */
export function weekdayOf(dateKey: string): number {
  const wd = keyToUtcNoon(dateKey).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function addDays(dateKey: string, days: number): string {
  const d = keyToUtcNoon(dateKey);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetweenInclusive(from: string, to: string): number {
  return Math.round((keyToUtcNoon(to).getTime() - keyToUtcNoon(from).getTime()) / 86_400_000) + 1;
}

/** "08:30" -> 510. Returns NaN for invalid input. */
export function parseHHMM(value: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

export function formatHHMM(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The instant that a local date + "HH:MM" in the college time zone refers to. */
export function zonedDateTime(dateKey: string, hhmm: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const mins = parseHHMM(hhmm);
  const guess = Date.UTC(y, m - 1, d, Math.floor(mins / 60), mins % 60);
  const z = zoned(new Date(guess));
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second);
  const offset = asUtc - guess; // time zone offset at that moment
  return new Date(guess - offset);
}

export const WEEKDAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const WEEKDAY_LONG = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const dateKeyFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const monthFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "Mon, 9 Nov 2026" */
export const formatDateKey = (dateKey: string) => dateKeyFmt.format(keyToUtcNoon(dateKey));
/** "November 2026" for a YYYY-MM month key */
export const formatMonthKey = (monthKey: string) => monthFmt.format(keyToUtcNoon(`${monthKey}-15`));
/** "09:05" in the college time zone */
export const formatTime = (d: Date) => timeFmt.format(d);

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** Weeks (Monday first) covering a month; days outside the month are null. */
export function monthWeeks(monthKey: string): (string | null)[][] {
  const first = `${monthKey}-01`;
  const [y, m] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array(weekdayOf(first) - 1).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${monthKey}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
