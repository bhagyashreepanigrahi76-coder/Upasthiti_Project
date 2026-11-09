"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { readTable } from "@/lib/spreadsheet";
import { type ActionState, failure, success } from "@/lib/action-state";
import {
  type ImportRow,
  type StudentRow,
  type TeacherRow,
  STUDENT_REQUIRED,
  TEACHER_REQUIRED,
  commitStudents,
  commitTeachers,
  missingColumns,
  validateStudents,
  validateTeachers,
} from "@/lib/importers";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;

export async function previewImport(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const kind = formData.get("kind") === "TEACHERS" ? "TEACHERS" : "STUDENTS";
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { fieldErrors: { file: "Choose a CSV or Excel file" }, error: "No file chosen." };
  if (file.size > MAX_BYTES) return failure("The file is larger than 5 MB.");
  if (!/\.(csv|xlsx)$/i.test(file.name)) return failure("Use a .csv or .xlsx file. Older .xls files: save as .xlsx first.");

  let table;
  try {
    table = await readTable(file);
  } catch (err) {
    return failure(err instanceof Error ? err.message : "The file could not be read.");
  }
  if (table.rows.length === 0) return failure("The file has no data rows under the header.");
  if (table.rows.length > MAX_ROWS) return failure(`Import at most ${MAX_ROWS} rows at a time.`);

  const missing = missingColumns(table.headers, kind === "STUDENTS" ? STUDENT_REQUIRED : TEACHER_REQUIRED);
  if (missing.length) return failure(`Missing column(s): ${missing.join(", ")}. Download the template to see the expected header.`);

  const rows: ImportRow<StudentRow | TeacherRow>[] =
    kind === "STUDENTS" ? await validateStudents(table.rows) : await validateTeachers(table.rows);
  const job = await db.importJob.create({
    data: {
      kind,
      fileName: file.name.slice(0, 200),
      totalRows: rows.length,
      validRows: rows.filter((r) => r.data).length,
      payload: JSON.stringify(rows),
      createdById: admin.id,
    },
  });
  await logAudit({ actorId: admin.id, action: "IMPORT_PREVIEWED", entityType: "ImportJob", entityId: job.id, details: { kind, rows: rows.length } });
  redirect(`/admin/import?job=${job.id}`);
}

export async function commitImport(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const jobId = String(formData.get("id") ?? "");
  // Claim the job atomically so a double click cannot import twice.
  const claimed = await db.importJob.updateMany({ where: { id: jobId, status: "PREVIEW" }, data: { status: "COMMITTED", committedAt: new Date() } });
  if (claimed.count === 0) return failure("This import was already committed or discarded.");
  const job = await db.importJob.findUniqueOrThrow({ where: { id: jobId } });

  const rows = (JSON.parse(job.payload) as ImportRow<StudentRow | TeacherRow>[]).filter((r) => r.data).map((r) => r.data);
  const result =
    job.kind === "STUDENTS" ? await commitStudents(rows as StudentRow[]) : await commitTeachers(rows as TeacherRow[]);

  await logAudit({
    actorId: admin.id,
    action: "IMPORT_COMMITTED",
    entityType: "ImportJob",
    entityId: job.id,
    details: { kind: job.kind, created: result.created, skipped: result.skipped },
  });
  refresh();
  const skippedNote = result.skipped.length ? ` Skipped (taken in the meantime): ${result.skipped.join(", ")}.` : "";
  return success(
    `Created ${result.created} account${result.created === 1 ? "" : "s"}.${skippedNote} Each person activates their account from the sign-in page with "First time here?", using a code sent to their email or phone.`,
  );
}

export async function discardImport(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const jobId = String(formData.get("id") ?? "");
  await db.importJob.updateMany({ where: { id: jobId, status: "PREVIEW" }, data: { status: "DISCARDED", payload: "[]" } });
  await logAudit({ actorId: admin.id, action: "IMPORT_DISCARDED", entityType: "ImportJob", entityId: jobId });
  redirect("/admin/import");
}
