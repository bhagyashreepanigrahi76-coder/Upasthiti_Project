"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { departmentsFor, getTeacherProfile, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { deleteUpload, saveUpload } from "@/lib/uploads";
import { NOTES_MAX_MB, canDeleteNote } from "@/lib/notes";
import { notifyUsers, studentUserIds } from "@/lib/notify";
import { type ActionState, failure, formValues, fromZodError, success } from "@/lib/action-state";

const noteSchema = z.object({
  subjectId: z.string().min(1, "Choose the subject"),
  sectionId: z.string().optional(), // empty = all sections of that year
  title: z.string().trim().min(3, "Give the notes a title").max(150),
  description: z.string().trim().max(1000).optional(),
  tags: z.string().trim().max(200).optional(),
});

/** Teachers upload notes for subjects they teach; HODs for their department. */
export async function uploadNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = noteSchema.safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const v = parsed.data;
  const subject = await db.subject.findUnique({ where: { id: v.subjectId } });
  if (!subject) return failure("Subject not found.");

  const teacher = await getTeacherProfile(user.id);
  const teaches = teacher ? await db.teacherSubject.findMany({ where: { teacherId: teacher.id, subjectId: subject.id } }) : [];
  const isHod = departmentsFor(user, "HOD").includes(subject.departmentId);
  if (!teaches.length && !isHod && !user.roles.includes("ADMIN")) return failure("You can upload notes only for subjects you teach.");
  if (v.sectionId && !isHod && !user.roles.includes("ADMIN") && !teaches.some((t) => t.sectionId === v.sectionId)) {
    return { error: "Choose a section you teach, or all sections.", fieldErrors: { sectionId: "Not your section" } };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload.", fieldErrors: { file: "Choose a file" } };
  let stored;
  try {
    stored = await saveUpload(file, "notes", NOTES_MAX_MB, { allowWord: true, allowSlides: true });
  } catch (err) {
    return { error: (err as Error).message, fieldErrors: { file: (err as Error).message } };
  }
  const tags = v.tags
    ?.split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .join(", ");
  const note = await db.note.create({
    data: {
      title: v.title,
      description: v.description,
      tags: tags || null,
      subjectId: subject.id,
      departmentId: subject.departmentId,
      year: subject.year,
      sectionId: v.sectionId ?? null,
      uploadedById: user.id,
      filePath: stored.path,
      fileName: stored.name,
      fileMime: stored.mime,
      fileSize: stored.size,
    },
  });
  await notifyUsers(await studentUserIds({ departmentId: subject.departmentId, year: subject.year, sectionId: v.sectionId }), {
    title: `New notes: ${v.title}`,
    body: `${subject.code} · ${subject.name}, from ${user.name}`,
    link: "/student/notes",
  });
  await logAudit({ actorId: user.id, action: "NOTE_UPLOADED", entityType: "Note", entityId: note.id, details: { title: v.title, subject: subject.code } });
  refresh();
  return success(`"${v.title}" uploaded. Students of ${subject.code} have been notified.`);
}

export async function deleteNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const note = await db.note.findUnique({ where: { id: String(formData.get("id") ?? "") } });
  if (!note || !canDeleteNote(user, note)) return failure("You can delete only your own notes.");
  await db.note.delete({ where: { id: note.id } });
  await deleteUpload(note.filePath);
  await logAudit({ actorId: user.id, action: "NOTE_DELETED", entityType: "Note", entityId: note.id, details: { title: note.title } });
  refresh();
  return success("Notes deleted.");
}
