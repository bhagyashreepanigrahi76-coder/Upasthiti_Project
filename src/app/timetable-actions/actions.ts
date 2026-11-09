"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { departmentsFor, getTeacherProfile, requireUser, type CurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { isDateKey, toDateKey, formatDateKey, weekdayOf, WEEKDAY_LONG } from "@/lib/dates";
import { notifyUsers, studentUserIds } from "@/lib/notify";
import { readTable } from "@/lib/spreadsheet";
import { type SlotInput, detectClashes, effectiveTimetable, sectionDay, slotInputSchema, teacherDay } from "@/lib/timetable";
import { type ActionState, failure, formValues, fromZodError, success } from "@/lib/action-state";
import { isUniqueViolation } from "@/lib/db-errors";

// FR-66: Admin edits all timetables, HOD edits their own department.
async function canEditSection(user: CurrentUser, sectionId: string) {
  const section = await db.section.findUnique({ where: { id: sectionId } });
  if (!section) return null;
  if (user.roles.includes("ADMIN") || departmentsFor(user, "HOD").includes(section.departmentId)) return section;
  return null;
}

async function saveVersion(user: CurrentUser, sectionId: string, effectiveFrom: string, slots: SlotInput[], note?: string): Promise<ActionState> {
  const section = await canEditSection(user, sectionId);
  if (!section) return failure("You cannot edit this section's timetable.");
  const today = toDateKey(new Date());
  // FR-64: past days keep the timetable that was active then.
  if (effectiveFrom < today) return { fieldErrors: { effectiveFrom: "Choose today or a later date" }, error: "A new version cannot start in the past." };

  const clashes = await detectClashes(sectionId, effectiveFrom, slots);
  if (clashes.length) return { error: `Not saved. Fix these clashes:\n• ${clashes.slice(0, 12).join("\n• ")}` };

  const existing = await db.timetable.findUnique({ where: { sectionId_effectiveFrom: { sectionId, effectiveFrom } } });
  const semester = section.year * 2 - (new Date().getUTCMonth() >= 5 && new Date().getUTCMonth() <= 10 ? 1 : 0);
  const tt = await db.$transaction(async (tx) => {
    const t = existing
      ? await tx.timetable.update({ where: { id: existing.id }, data: { note: note ?? existing.note } })
      : await tx.timetable.create({
          data: { sectionId, academicYearId: section.academicYearId, semester, effectiveFrom, note, createdById: user.id },
        });
    await tx.timetableSlot.deleteMany({ where: { timetableId: t.id } });
    if (slots.length) await tx.timetableSlot.createMany({ data: slots.map((s) => ({ ...s, timetableId: t.id })) });
    return t;
  });

  const teacherIds = [...new Set(slots.map((s) => s.teacherId).filter((x): x is string => !!x))];
  const teacherUsers = await db.teacher.findMany({ where: { id: { in: teacherIds } }, select: { userId: true } });
  await notifyUsers(await studentUserIds({ sectionId }), {
    title: "Timetable updated",
    body: `Your section's timetable changes from ${formatDateKey(effectiveFrom)}.`,
    link: "/student/timetable",
  });
  await notifyUsers(teacherUsers.map((t) => t.userId), {
    title: "Timetable updated",
    body: `A section you teach has a new timetable from ${formatDateKey(effectiveFrom)}.`,
    link: "/teacher/timetable",
  });
  await logAudit({
    actorId: user.id,
    action: existing ? "TIMETABLE_UPDATED" : "TIMETABLE_VERSION_CREATED",
    entityType: "Timetable",
    entityId: tt.id,
    details: { sectionId, effectiveFrom, slots: slots.length },
  });
  refresh();
  return success(existing ? `Timetable from ${formatDateKey(effectiveFrom)} updated.` : `New timetable version saved, in force from ${formatDateKey(effectiveFrom)}.`);
}

export async function saveTimetable(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const v = formValues(formData);
  const parsed = z
    .object({
      sectionId: z.string().min(1),
      effectiveFrom: z.string().refine(isDateKey, "Enter a valid date"),
      note: z.string().max(200).optional(),
      slots: z.string(),
    })
    .safeParse(v);
  if (!parsed.success) return fromZodError(parsed.error);
  let slots: SlotInput[];
  try {
    slots = z.array(slotInputSchema).max(200).parse(JSON.parse(parsed.data.slots));
  } catch {
    return failure("The timetable data was not valid. Reload the page and try again.");
  }
  return saveVersion(user, parsed.data.sectionId, parsed.data.effectiveFrom, slots, parsed.data.note);
}

const DAY_NAMES: Record<string, number> = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

/** FR-57 CSV/Excel import: day, period, span, type, subject, teacher, room, batch. */
export async function importTimetable(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const sectionId = String(formData.get("sectionId") ?? "");
  const effectiveFrom = String(formData.get("effectiveFrom") ?? "");
  if (!isDateKey(effectiveFrom)) return { fieldErrors: { effectiveFrom: "Enter a valid date" }, error: "Choose when it takes effect." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return failure("Choose a CSV or Excel file.");
  if (file.size > 1024 * 1024) return failure("The file is larger than 1 MB.");

  let table;
  try {
    table = await readTable(file);
  } catch (err) {
    return failure(err instanceof Error ? err.message : "The file could not be read.");
  }
  const missing = ["day", "period", "subject"].filter((c) => !table.headers.includes(c));
  if (missing.length) return failure(`Missing column(s): ${missing.join(", ")}.`);

  const [subjects, teachers, rooms, batches] = await Promise.all([
    db.subject.findMany(),
    db.teacher.findMany({ include: { user: { select: { collegeId: true } } } }),
    db.room.findMany(),
    db.batch.findMany({ where: { sectionId } }),
  ]);
  const errors: string[] = [];
  const slots: SlotInput[] = [];
  table.rows.forEach((r, i) => {
    const line = `Line ${i + 2}`;
    const dayOfWeek = DAY_NAMES[(r.day ?? "").slice(0, 3).toUpperCase()] ?? Number(r.day);
    const type = (r.type || (r.subject ? "LECTURE" : "FREE")).toUpperCase();
    const subject = r.subject ? subjects.find((s) => s.code === r.subject.toUpperCase()) : null;
    const teacher = r.teacher ? teachers.find((t) => t.user.collegeId === r.teacher.toUpperCase()) : null;
    const room = r.room ? rooms.find((x) => x.name.toUpperCase() === r.room.toUpperCase()) : null;
    const batch = r.batch ? batches.find((b) => b.name.toLowerCase() === r.batch.toLowerCase() || b.name === `Batch ${r.batch}`) : null;
    if (!(dayOfWeek >= 1 && dayOfWeek <= 6)) return errors.push(`${line}: day must be Mon-Sat`);
    if (r.subject && !subject) return errors.push(`${line}: subject ${r.subject} not found`);
    if (r.teacher && !teacher) return errors.push(`${line}: teacher ${r.teacher} not found`);
    if (r.room && !room) return errors.push(`${line}: room ${r.room} not found`);
    if (r.batch && !batch) return errors.push(`${line}: batch ${r.batch} not found in this section`);
    const parsed = slotInputSchema.safeParse({
      dayOfWeek,
      periodNumber: Number(r.period),
      span: Number(r.span || 1),
      type,
      subjectId: subject?.id ?? null,
      teacherId: teacher?.id ?? null,
      roomId: room?.id ?? null,
      batchId: batch?.id ?? null,
    });
    if (!parsed.success) errors.push(`${line}: check period, span and type`);
    else slots.push(parsed.data);
  });
  if (errors.length) return { error: `Nothing imported:\n• ${errors.slice(0, 10).join("\n• ")}` };
  return saveVersion(user, sectionId, effectiveFrom, slots, `Imported from ${file.name}`);
}

// --- Day-of changes (FR-63) -------------------------------------------------

const changeSchema = z.object({
  sectionId: z.string().min(1),
  dateKey: z.string().refine(isDateKey, "Enter a valid date"),
  type: z.enum(["CANCELLED", "SUBSTITUTED", "EXTRA"]),
  slotId: z.string().optional(),
  periodNumber: z.coerce.number().int().min(1).max(20).optional(),
  substituteTeacherId: z.string().optional(),
  subjectId: z.string().optional(),
  note: z.string().trim().max(200).optional(),
});

export async function markPeriodChange(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = changeSchema.safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const c = parsed.data;
  if (c.dateKey < toDateKey(new Date())) return { fieldErrors: { dateKey: "Choose today or a later date" }, error: "Past days cannot be changed." };

  const isEditor = Boolean(await canEditSection(user, c.sectionId));
  const teacher = await getTeacherProfile(user.id);
  const dow = weekdayOf(c.dateKey);
  const tt = await effectiveTimetable(c.sectionId, c.dateKey);
  const slot = c.slotId ? tt?.slots.find((s) => s.id === c.slotId && s.dayOfWeek === dow) : undefined;

  let periodNumber: number;
  let subjectId: string | null = null;
  let substituteTeacherId: string | null = null;

  if (c.type === "CANCELLED" || c.type === "SUBSTITUTED") {
    if (!slot) return failure(`That period is not on the ${WEEKDAY_LONG[dow]} timetable for this section.`);
    // Teachers may cancel their own period; substitutions need the HOD/admin.
    const ownsSlot = teacher && slot.teacherId === teacher.id;
    if (c.type === "CANCELLED" && !ownsSlot && !isEditor) return failure("You can only cancel your own periods.");
    if (c.type === "SUBSTITUTED" && !isEditor) return failure("Only the HOD or admin can assign a substitute.");
    periodNumber = slot.periodNumber;
    if (c.type === "SUBSTITUTED") {
      if (!c.substituteTeacherId) return { fieldErrors: { substituteTeacherId: "Choose the substitute" }, error: "Choose the substitute teacher." };
      const busy = (await teacherDay(c.substituteTeacherId, c.dateKey)).some(
        (p) => p.status !== "CANCELLED" && p.periodNumber <= periodNumber + slot.span - 1 && periodNumber <= p.periodNumber + p.span - 1,
      );
      if (busy) return failure("The substitute already has a class at that time.");
      substituteTeacherId = c.substituteTeacherId;
    }
  } else {
    if (!c.periodNumber || !c.subjectId) return failure("Choose the period and subject for the extra class.");
    const takingTeacher = isEditor ? (c.substituteTeacherId ?? teacher?.id) : teacher?.id;
    if (!takingTeacher) return failure("Choose who takes the extra class.");
    if (!isEditor) {
      const teaches = await db.teacherSubject.findFirst({ where: { teacherId: takingTeacher, subjectId: c.subjectId, sectionId: c.sectionId } });
      if (!teaches) return failure("You can only add extra classes for subjects you teach this section.");
    }
    const day = await sectionDay(c.sectionId, c.dateKey);
    if (!day.working) return failure(`No classes that day (${day.reason}).`);
    if (day.periods.some((p) => p.status !== "CANCELLED" && p.periodNumber <= c.periodNumber! && c.periodNumber! <= p.periodNumber + p.span - 1)) {
      return failure("The section already has a class in that period.");
    }
    if ((await teacherDay(takingTeacher, c.dateKey)).some((p) => p.status !== "CANCELLED" && p.periodNumber <= c.periodNumber! && c.periodNumber! <= p.periodNumber + p.span - 1)) {
      return failure("That teacher already has a class in that period.");
    }
    periodNumber = c.periodNumber;
    subjectId = c.subjectId;
    substituteTeacherId = takingTeacher;
  }

  if (slot) {
    const already = await db.periodChange.findFirst({ where: { timetableSlotId: slot.id, dateKey: c.dateKey } });
    if (already) return failure("That period already has a change for this date. Remove it first.");
  }

  const change = await db.periodChange.create({
    data: {
      dateKey: c.dateKey,
      sectionId: c.sectionId,
      timetableSlotId: slot?.id ?? null,
      periodNumber,
      type: c.type,
      substituteTeacherId,
      subjectId,
      note: c.note,
      createdById: user.id,
    },
  });

  const words = { CANCELLED: "cancelled", SUBSTITUTED: "has a substitute teacher", EXTRA: "added as an extra class" }[c.type];
  const body = `${formatDateKey(c.dateKey)}, period ${periodNumber}${c.note ? ` · ${c.note}` : ""}`;
  await notifyUsers(await studentUserIds({ sectionId: c.sectionId }), { title: `Period ${words}`, body, link: "/student/timetable" });
  const teacherIds = [slot?.teacherId, substituteTeacherId].filter((x): x is string => !!x);
  const teacherUsers = await db.teacher.findMany({ where: { id: { in: teacherIds } }, select: { userId: true } });
  await notifyUsers(teacherUsers.map((t) => t.userId).filter((id) => id !== user.id), { title: `Period ${words}`, body, link: "/teacher/timetable" });
  await logAudit({ actorId: user.id, action: `PERIOD_${c.type}`, entityType: "PeriodChange", entityId: change.id, details: c });
  refresh();
  return success(`Period ${periodNumber} on ${formatDateKey(c.dateKey)} ${words}. Students and teachers were notified.`);
}

export async function removePeriodChange(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const change = await db.periodChange.findUnique({ where: { id } });
  if (!change) return failure("Not found.");
  const isEditor = Boolean(await canEditSection(user, change.sectionId));
  if (!isEditor && change.createdById !== user.id) return failure("Only the person who made the change, the HOD or admin can undo it.");
  await db.periodChange.delete({ where: { id } });
  await notifyUsers(await studentUserIds({ sectionId: change.sectionId }), {
    title: "Timetable change withdrawn",
    body: `${formatDateKey(change.dateKey)}, period ${change.periodNumber} is back to normal.`,
    link: "/student/timetable",
  });
  await logAudit({ actorId: user.id, action: "PERIOD_CHANGE_REMOVED", entityType: "PeriodChange", entityId: id });
  refresh();
  return success("Change removed.");
}

// --- Period timings and rooms (admin, FR-54/55) ---------------------------------

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

export async function addPeriodTiming(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!user.roles.includes("ADMIN")) return failure("Admin only.");
  const parsed = z
    .object({
      dayType: z.enum(["WEEKDAY", "SATURDAY"]),
      isBreak: z.string().optional(),
      label: z.string().trim().max(30).optional(),
      startTime: hhmm,
      endTime: hhmm,
    })
    .refine((v) => v.endTime > v.startTime, { path: ["endTime"], message: "Must be after the start" })
    .safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const p = parsed.data;
  const existing = await db.periodTiming.findMany({ where: { dayType: p.dayType }, orderBy: { sortOrder: "asc" } });
  if (existing.some((e) => p.startTime < e.endTime && e.startTime < p.endTime)) return failure("That time overlaps an existing period or break.");
  const all = [...existing, { ...p, periodNumber: null, sortOrder: 0, id: "new" }].sort((a, b) => a.startTime.localeCompare(b.startTime));
  // Renumber everything in time order so period numbers stay 1, 2, 3...
  let n = 0;
  await db.$transaction(async (tx) => {
    await tx.periodTiming.deleteMany({ where: { dayType: p.dayType } });
    for (const [i, t] of all.entries()) {
      const isBreak = t.id === "new" ? Boolean(p.isBreak) : t.periodNumber == null;
      await tx.periodTiming.create({
        data: {
          dayType: p.dayType,
          sortOrder: i + 1,
          periodNumber: isBreak ? null : ++n,
          label: t.id === "new" ? (p.label ?? (isBreak ? "Break" : null)) : t.label,
          startTime: t.startTime,
          endTime: t.endTime,
        },
      });
    }
  });
  await logAudit({ actorId: user.id, action: "PERIOD_TIMING_ADDED", details: p });
  refresh();
  return success("Timing added. Periods were renumbered in time order.");
}

export async function deletePeriodTiming(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!user.roles.includes("ADMIN")) return failure("Admin only.");
  const id = String(formData.get("id") ?? "");
  const t = await db.periodTiming.findUnique({ where: { id } });
  if (!t) return failure("Not found.");
  if (t.periodNumber != null) {
    const used = await db.timetableSlot.count({
      where: { periodNumber: t.periodNumber, dayOfWeek: t.dayType === "SATURDAY" ? 6 : { lte: 5 } },
    });
    if (used) return failure(`Period ${t.periodNumber} is used in ${used} timetable slot(s). Remove those first.`);
  }
  await db.periodTiming.delete({ where: { id } });
  await logAudit({ actorId: user.id, action: "PERIOD_TIMING_DELETED", details: { dayType: t.dayType, startTime: t.startTime } });
  refresh();
  return success("Timing removed.");
}

export async function saveRoom(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!user.roles.includes("ADMIN")) return failure("Admin only.");
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(30).transform((s) => s.toUpperCase()),
      type: z.enum(["CLASSROOM", "LAB", "HALL"]),
      capacity: z.coerce.number().int().min(1).max(1000).optional(),
    })
    .safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  try {
    await db.room.create({ data: parsed.data });
  } catch (err) {
    if (isUniqueViolation(err)) return failure(`Room ${parsed.data.name} already exists.`);
    throw err;
  }
  await logAudit({ actorId: user.id, action: "ROOM_CREATED", details: parsed.data });
  refresh();
  return success(`Room ${parsed.data.name} added.`);
}

export async function deleteRoom(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!user.roles.includes("ADMIN")) return failure("Admin only.");
  const id = String(formData.get("id") ?? "");
  const used = await db.timetableSlot.count({ where: { roomId: id } });
  if (used) return failure(`The room is used in ${used} timetable slot(s).`);
  await db.room.delete({ where: { id } }).catch(() => null);
  await logAudit({ actorId: user.id, action: "ROOM_DELETED", entityId: id });
  refresh();
  return success("Room deleted.");
}
