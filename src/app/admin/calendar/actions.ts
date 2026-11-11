"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { CalendarEventType } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { isDateKey, formatDateKey, weekdayOf } from "@/lib/dates";
import { notifyUsers, studentUserIds, teacherUserIds } from "@/lib/notify";
import { parseFlexibleDate, readTable } from "@/lib/spreadsheet";
import { type ActionState, failure, formValues, fromZodError, success } from "@/lib/action-state";

// FR-14/15/16: academic calendar. Changes notify the affected students and teachers.

const TYPES = ["HOLIDAY", "EXAM", "WORKING_SATURDAY", "EVENT"] as const;
const TYPE_LABEL: Record<CalendarEventType, string> = {
  HOLIDAY: "Holiday",
  EXAM: "Exam",
  WORKING_SATURDAY: "Working Saturday",
  EVENT: "Event",
};

const eventSchema = z
  .object({
    title: z.string().trim().min(2, "Enter a title").max(120),
    description: z.string().trim().max(500).optional(),
    type: z.enum(TYPES),
    startDate: z.string().refine(isDateKey, "Enter a valid date"),
    endDate: z.string().refine(isDateKey, "Enter a valid date").optional(),
    departmentId: z.string().optional(),
    year: z.coerce.number().int().min(1).max(3).optional(),
  })
  .transform((v) => ({ ...v, endDate: v.endDate ?? v.startDate }))
  .refine((v) => v.endDate >= v.startDate, { path: ["endDate"], message: "End date is before the start date" })
  .refine((v) => v.type !== "WORKING_SATURDAY" || (v.startDate === v.endDate && weekdayOf(v.startDate) === 6), {
    path: ["startDate"],
    message: "A working Saturday must be a single Saturday",
  });

type EventInput = z.infer<typeof eventSchema>;

async function notifyChange(e: EventInput, verb: "added" | "removed") {
  const when = e.startDate === e.endDate ? formatDateKey(e.startDate) : `${formatDateKey(e.startDate)} – ${formatDateKey(e.endDate)}`;
  const title = `Calendar ${verb}: ${TYPE_LABEL[e.type]} · ${e.title}`;
  await notifyUsers(await studentUserIds({ departmentId: e.departmentId, year: e.year }), { title, body: when, link: "/student/calendar" });
  await notifyUsers(await teacherUserIds(e.departmentId), { title, body: when, link: "/teacher/calendar" });
}

export async function createEvent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const parsed = eventSchema.safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const ay = await db.academicYear.findFirst({ where: { isCurrent: true } });
  const event = await db.calendarEvent.create({
    data: { ...parsed.data, academicYearId: ay?.id, createdById: admin.id },
  });
  await notifyChange(parsed.data, "added");
  await logAudit({ actorId: admin.id, action: "CALENDAR_EVENT_CREATED", entityType: "CalendarEvent", entityId: event.id, details: parsed.data });
  refresh();
  return success(`${TYPE_LABEL[parsed.data.type]} "${parsed.data.title}" added. Affected students and teachers were notified.`);
}

export async function deleteEvent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const event = await db.calendarEvent.findUnique({ where: { id } });
  if (!event) return failure("Entry not found.");
  await db.calendarEvent.delete({ where: { id } });
  await notifyChange(
    {
      ...event,
      description: event.description ?? undefined,
      departmentId: event.departmentId ?? undefined,
      year: event.year ?? undefined,
    },
    "removed",
  );
  await logAudit({ actorId: admin.id, action: "CALENDAR_EVENT_DELETED", entityType: "CalendarEvent", entityId: id, details: { title: event.title, startDate: event.startDate } });
  refresh();
  return success("Entry removed.");
}

/** CSV/Excel import: start_date, end_date, type, title, department, year, description. */
export async function importEvents(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return failure("Choose a CSV or Excel file.");
  if (file.size > 2 * 1024 * 1024) return failure("The file is larger than 2 MB.");

  let table;
  try {
    table = await readTable(file);
  } catch (err) {
    return failure(err instanceof Error ? err.message : "The file could not be read.");
  }
  const missing = ["start_date", "type", "title"].filter((c) => !table.headers.includes(c));
  if (missing.length) return failure(`Missing column(s): ${missing.join(", ")}.`);

  const departments = await db.department.findMany();
  const ay = await db.academicYear.findFirst({ where: { isCurrent: true } });
  const errors: string[] = [];
  const rows: EventInput[] = [];
  table.rows.forEach((r, i) => {
    const dept = r.department ? departments.find((d) => d.code === r.department.toUpperCase()) : undefined;
    if (r.department && !dept) return errors.push(`Line ${i + 2}: department "${r.department}" not found`);
    const parsed = eventSchema.safeParse({
      title: r.title,
      description: r.description || undefined,
      type: (r.type ?? "").toUpperCase().replace(/[\s-]+/g, "_"),
      startDate: parseFlexibleDate(r.start_date ?? "") ?? r.start_date,
      endDate: r.end_date ? (parseFlexibleDate(r.end_date) ?? r.end_date) : undefined,
      departmentId: dept?.id,
      year: r.year || undefined,
    });
    if (!parsed.success) errors.push(`Line ${i + 2}: ${parsed.error.issues[0].message}`);
    else rows.push(parsed.data);
  });
  // All or nothing, so a half-imported calendar never confuses students.
  if (errors.length) return { error: `Nothing imported. Fix these and try again: ${errors.slice(0, 8).join("; ")}${errors.length > 8 ? "…" : ""}` };
  if (rows.length === 0) return failure("The file has no rows.");

  await db.calendarEvent.createMany({ data: rows.map((r) => ({ ...r, academicYearId: ay?.id, createdById: admin.id })) });
  const title = `Academic calendar updated: ${rows.length} new entries`;
  await notifyUsers(await studentUserIds({}), { title, link: "/student/calendar" });
  await notifyUsers(await teacherUserIds(), { title, link: "/teacher/calendar" });
  await logAudit({ actorId: admin.id, action: "CALENDAR_IMPORTED", details: { rows: rows.length, file: file.name } });
  refresh();
  return success(`Imported ${rows.length} calendar entr${rows.length === 1 ? "y" : "ies"}. Everyone was notified.`);
}
