import "server-only";
import { z } from "zod";
import type { PeriodTiming, Prisma } from "@prisma/client";
import { db } from "./db";
import { getDayStatus } from "./calendar";
import { WEEKDAY_SHORT, weekdayOf } from "./dates";

// Class and section timetables (PRD §4.10).

export const slotInputSchema = z.object({
  dayOfWeek: z.number().int().min(1).max(6),
  periodNumber: z.number().int().min(1).max(20),
  span: z.number().int().min(1).max(4),
  type: z.enum(["LECTURE", "PRACTICAL", "TUTORIAL", "FREE"]),
  subjectId: z.string().nullable(),
  teacherId: z.string().nullable(),
  roomId: z.string().nullable(),
  batchId: z.string().nullable(),
});
export type SlotInput = z.infer<typeof slotInputSchema>;

export type Timings = { WEEKDAY: PeriodTiming[]; SATURDAY: PeriodTiming[] };

export async function getTimings(): Promise<Timings> {
  const rows = await db.periodTiming.findMany({ orderBy: [{ dayType: "asc" }, { sortOrder: "asc" }] });
  return { WEEKDAY: rows.filter((r) => r.dayType === "WEEKDAY"), SATURDAY: rows.filter((r) => r.dayType === "SATURDAY") };
}

export const dayTypeOf = (dow: number) => (dow === 6 ? "SATURDAY" : "WEEKDAY");

/** Teaching period numbers for a weekday. */
export function teachingPeriods(timings: Timings, dow: number): PeriodTiming[] {
  return timings[dayTypeOf(dow)].filter((t) => t.periodNumber != null);
}

/** "09:00–10:50" for a slot starting at a period and spanning N periods. */
export function slotTime(timings: Timings, dow: number, periodNumber: number, span: number) {
  const periods = teachingPeriods(timings, dow);
  const first = periods.find((p) => p.periodNumber === periodNumber);
  const last = periods.find((p) => p.periodNumber === periodNumber + span - 1);
  return { start: first?.startTime ?? "?", end: last?.endTime ?? first?.endTime ?? "?" };
}

const slotInclude = {
  subject: true,
  teacher: { include: { user: { select: { name: true } } } },
  room: true,
  batch: true,
} satisfies Prisma.TimetableSlotInclude;

export type SlotWithDetails = Prisma.TimetableSlotGetPayload<{ include: typeof slotInclude }>;

/** FR-64: the version in force on a date (latest effectiveFrom on or before it). */
export function effectiveTimetable(sectionId: string, dateKey: string) {
  return db.timetable.findFirst({
    where: { sectionId, effectiveFrom: { lte: dateKey } },
    orderBy: { effectiveFrom: "desc" },
    include: { slots: { include: slotInclude } },
  });
}

/** The latest version of every section's timetable in force on a date. */
export async function effectiveTimetables(dateKey: string) {
  const all = await db.timetable.findMany({
    where: { effectiveFrom: { lte: dateKey } },
    orderBy: { effectiveFrom: "desc" },
    include: { slots: { include: slotInclude }, section: { include: { department: true } } },
  });
  const seen = new Set<string>();
  return all.filter((t) => (seen.has(t.sectionId) ? false : (seen.add(t.sectionId), true)));
}

export type ScheduledPeriod = {
  key: string;
  slotId: string | null;
  /** Stable ID of this period on this date: slot ID, or "x:<changeId>" for extra classes. */
  periodKey: string;
  teacherId: string | null; // who takes it today (the substitute, if any)
  subjectId: string | null;
  batchId: string | null;
  sectionId: string;
  sectionLabel: string;
  periodNumber: number;
  span: number;
  start: string;
  end: string;
  type: string;
  subject: string;
  teacherName: string | null;
  roomName: string | null;
  batchName: string | null;
  status: "SCHEDULED" | "CANCELLED" | "SUBSTITUTED" | "EXTRA";
  note: string | null;
};

export type DaySchedule = { working: boolean; reason: string | null; periods: ScheduledPeriod[] };

const sectionLabel = (s: { year: number; name: string; department: { code: string } }) => `${s.department.code} ${s.year}-${s.name}`;

/** A section's periods on a date, with holidays, exam days and day-of changes applied (FR-62, FR-63). */
export async function sectionDay(sectionId: string, dateKey: string, batchId?: string | null): Promise<DaySchedule> {
  const section = await db.section.findUnique({ where: { id: sectionId }, include: { department: true } });
  if (!section) return { working: false, reason: "Section not found", periods: [] };
  const day = await getDayStatus(dateKey, { departmentId: section.departmentId, year: section.year });
  if (!day.working) return { working: false, reason: day.reason, periods: [] };
  if (day.exam) return { working: true, reason: "Exam day: regular classes are suspended", periods: [] };

  const dow = weekdayOf(dateKey);
  const [tt, timings, changes] = await Promise.all([
    effectiveTimetable(sectionId, dateKey),
    getTimings(),
    db.periodChange.findMany({
      where: { sectionId, dateKey },
      include: { substitute: { include: { user: { select: { name: true } } } }, subject: true },
    }),
  ]);
  const label = sectionLabel(section);
  const periods: ScheduledPeriod[] = (tt?.slots ?? [])
    .filter((s) => s.dayOfWeek === dow && s.type !== "FREE")
    .filter((s) => !batchId || !s.batchId || s.batchId === batchId)
    .map((s) => {
      const change = changes.find((c) => c.timetableSlotId === s.id);
      const time = slotTime(timings, dow, s.periodNumber, s.span);
      return {
        key: s.id,
        slotId: s.id,
        periodKey: s.id,
        teacherId: change?.type === "SUBSTITUTED" ? change.substituteTeacherId : s.teacherId,
        subjectId: s.subjectId,
        batchId: s.batchId,
        sectionId,
        sectionLabel: label,
        periodNumber: s.periodNumber,
        span: s.span,
        ...time,
        type: s.type,
        subject: s.subject ? `${s.subject.code} · ${s.subject.name}` : s.type,
        teacherName: change?.type === "SUBSTITUTED" ? (change.substitute?.user.name ?? null) : (s.teacher?.user.name ?? null),
        roomName: s.room?.name ?? null,
        batchName: s.batch?.name ?? null,
        status: change?.type === "CANCELLED" ? "CANCELLED" : change?.type === "SUBSTITUTED" ? "SUBSTITUTED" : "SCHEDULED",
        note: change?.note ?? (change?.type === "SUBSTITUTED" ? `Instead of ${s.teacher?.user.name ?? "the usual teacher"}` : null),
      };
    });
  for (const c of changes.filter((c) => c.type === "EXTRA")) {
    periods.push({
      key: c.id,
      slotId: null,
      periodKey: `x:${c.id}`,
      teacherId: c.substituteTeacherId,
      subjectId: c.subjectId,
      batchId: null,
      sectionId,
      sectionLabel: label,
      periodNumber: c.periodNumber,
      span: 1,
      ...slotTime(timings, dow, c.periodNumber, 1),
      type: "LECTURE",
      subject: c.subject ? `${c.subject.code} · ${c.subject.name}` : "Extra class",
      teacherName: c.substitute?.user.name ?? null,
      roomName: null,
      batchName: null,
      status: "EXTRA",
      note: c.note,
    });
  }
  return { working: true, reason: null, periods: periods.sort((a, b) => a.periodNumber - b.periodNumber) };
}

/** A teacher's periods across all sections on a date (FR-59), including cover and extra classes. */
export async function teacherDay(teacherId: string, dateKey: string): Promise<ScheduledPeriod[]> {
  const dow = weekdayOf(dateKey);
  if (dow === 7) return [];
  const [tts, timings, changes] = await Promise.all([
    effectiveTimetables(dateKey),
    getTimings(),
    db.periodChange.findMany({
      where: { dateKey },
      include: {
        substitute: { include: { user: { select: { name: true } } } },
        subject: true,
        section: { include: { department: true } },
        slot: { include: slotInclude },
      },
    }),
  ]);

  const dayCache = new Map<string, Awaited<ReturnType<typeof getDayStatus>>>();
  const dayFor = async (s: { departmentId: string; year: number }) => {
    const k = `${s.departmentId}:${s.year}`;
    if (!dayCache.has(k)) dayCache.set(k, await getDayStatus(dateKey, s));
    return dayCache.get(k)!;
  };

  const out: ScheduledPeriod[] = [];
  for (const tt of tts) {
    const day = await dayFor(tt.section);
    if (!day.working || day.exam) continue;
    for (const s of tt.slots.filter((x) => x.dayOfWeek === dow && x.teacherId === teacherId && x.type !== "FREE")) {
      const change = changes.find((c) => c.timetableSlotId === s.id);
      out.push({
        key: s.id,
        slotId: s.id,
        periodKey: s.id,
        teacherId: s.teacherId,
        subjectId: s.subjectId,
        batchId: s.batchId,
        sectionId: tt.sectionId,
        sectionLabel: sectionLabel(tt.section),
        periodNumber: s.periodNumber,
        span: s.span,
        ...slotTime(timings, dow, s.periodNumber, s.span),
        type: s.type,
        subject: s.subject ? `${s.subject.code} · ${s.subject.name}` : s.type,
        teacherName: s.teacher?.user.name ?? null,
        roomName: s.room?.name ?? null,
        batchName: s.batch?.name ?? null,
        status: change?.type === "CANCELLED" ? "CANCELLED" : change?.type === "SUBSTITUTED" ? "SUBSTITUTED" : "SCHEDULED",
        note: change?.type === "SUBSTITUTED" ? `Covered by ${change.substitute?.user.name}` : (change?.note ?? null),
      });
    }
  }
  // Periods this teacher covers for someone else, and extra classes they take.
  for (const c of changes.filter((c) => c.substituteTeacherId === teacherId)) {
    const s = c.slot;
    out.push({
      key: c.id,
      slotId: s?.id ?? null,
      periodKey: c.type === "EXTRA" ? `x:${c.id}` : (s?.id ?? c.id),
      teacherId: c.substituteTeacherId,
      subjectId: c.subjectId ?? s?.subjectId ?? null,
      batchId: s?.batchId ?? null,
      sectionId: c.sectionId,
      sectionLabel: sectionLabel(c.section),
      periodNumber: c.periodNumber,
      span: s?.span ?? 1,
      ...slotTime(timings, dow, c.periodNumber, s?.span ?? 1),
      type: s?.type ?? "LECTURE",
      subject: c.subject ? `${c.subject.code} · ${c.subject.name}` : s?.subject ? `${s.subject.code} · ${s.subject.name}` : "Class",
      teacherName: c.substitute?.user.name ?? null,
      roomName: s?.room?.name ?? null,
      batchName: s?.batch?.name ?? null,
      status: c.type === "EXTRA" ? "EXTRA" : "SUBSTITUTED",
      note: c.type === "EXTRA" ? (c.note ?? "Extra class") : `Covering for ${s?.teacher?.user.name ?? "a colleague"}`,
    });
  }
  return out.sort((a, b) => a.periodNumber - b.periodNumber);
}

const overlaps = (a: { periodNumber: number; span: number }, b: { periodNumber: number; span: number }) =>
  a.periodNumber <= b.periodNumber + b.span - 1 && b.periodNumber <= a.periodNumber + a.span - 1;

/**
 * FR-58: blocks a save when a teacher is in two places at once, a room is
 * double-booked, or the section has two classes at the same time (lab batches
 * may run in parallel). Also checks periods exist and subjects fit the section.
 */
export async function detectClashes(sectionId: string, effectiveFrom: string, slots: SlotInput[]): Promise<string[]> {
  const problems: string[] = [];
  const [section, timings, teachers, rooms, subjects] = await Promise.all([
    db.section.findUniqueOrThrow({ where: { id: sectionId }, include: { batches: true } }),
    getTimings(),
    db.teacher.findMany({ include: { user: { select: { name: true } } } }),
    db.room.findMany(),
    db.subject.findMany({ where: { id: { in: slots.map((s) => s.subjectId).filter((x): x is string => !!x) } } }),
  ]);
  const tName = (id: string | null) => teachers.find((t) => t.id === id)?.user.name ?? "A teacher";
  const rName = (id: string | null) => rooms.find((r) => r.id === id)?.name ?? "A room";
  const at = (s: SlotInput) => `${WEEKDAY_SHORT[s.dayOfWeek]} P${s.periodNumber}${s.span > 1 ? `-${s.periodNumber + s.span - 1}` : ""}`;

  slots.forEach((s) => {
    const nums = teachingPeriods(timings, s.dayOfWeek).map((p) => p.periodNumber!);
    if (!nums.includes(s.periodNumber) || !nums.includes(s.periodNumber + s.span - 1)) {
      problems.push(`${at(s)}: that period does not exist on ${WEEKDAY_SHORT[s.dayOfWeek]}.`);
    }
    if (s.type !== "FREE" && !s.subjectId) problems.push(`${at(s)}: choose a subject.`);
    const subject = subjects.find((x) => x.id === s.subjectId);
    if (subject && (subject.year !== section.year || subject.departmentId !== section.departmentId)) {
      problems.push(`${at(s)}: ${subject.code} is not a subject of this section's department and year.`);
    }
    if (s.batchId && !section.batches.some((b) => b.id === s.batchId)) problems.push(`${at(s)}: that batch is not in this section.`);
  });

  // Within this section's grid.
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i];
      const b = slots[j];
      if (a.dayOfWeek !== b.dayOfWeek || !overlaps(a, b)) continue;
      const parallelBatches = a.batchId && b.batchId && a.batchId !== b.batchId;
      if (!parallelBatches) problems.push(`${at(a)}: the section has two classes at the same time.`);
      if (a.teacherId && a.teacherId === b.teacherId) problems.push(`${at(a)}: ${tName(a.teacherId)} is booked twice.`);
      if (a.roomId && a.roomId === b.roomId) problems.push(`${at(a)}: ${rName(a.roomId)} is booked twice.`);
    }
  }

  // Against other sections: their version in force on effectiveFrom, and any later versions.
  const others = await db.timetable.findMany({
    where: { sectionId: { not: sectionId } },
    orderBy: { effectiveFrom: "desc" },
    include: { slots: true, section: { include: { department: true } } },
  });
  const relevant: typeof others = [];
  const takenCurrent = new Set<string>();
  for (const v of others) {
    if (v.effectiveFrom > effectiveFrom) relevant.push(v);
    else if (!takenCurrent.has(v.sectionId)) {
      takenCurrent.add(v.sectionId);
      relevant.push(v);
    }
  }
  for (const s of slots) {
    for (const v of relevant) {
      for (const o of v.slots) {
        if (o.dayOfWeek !== s.dayOfWeek || !overlaps(o, s)) continue;
        const where = `${sectionLabel(v.section)}${v.effectiveFrom > effectiveFrom ? ` (from ${v.effectiveFrom})` : ""}`;
        if (s.teacherId && o.teacherId === s.teacherId) problems.push(`${at(s)}: ${tName(s.teacherId)} is already teaching ${where}.`);
        if (s.roomId && o.roomId === s.roomId) problems.push(`${at(s)}: ${rName(s.roomId)} is already used by ${where}.`);
      }
    }
  }
  return [...new Set(problems)];
}

/** Periods per week for each teacher in the versions currently in force (FR-58 workload). */
export async function teacherWorkload(dateKey: string): Promise<Map<string, number>> {
  const load = new Map<string, number>();
  for (const tt of await effectiveTimetables(dateKey)) {
    for (const s of tt.slots) {
      if (s.teacherId && s.type !== "FREE") load.set(s.teacherId, (load.get(s.teacherId) ?? 0) + s.span);
    }
  }
  return load;
}
