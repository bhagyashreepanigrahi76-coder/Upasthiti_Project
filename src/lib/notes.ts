import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { departmentsFor, getTeacherProfile, type CurrentUser } from "./auth";
import { textContains } from "./db-search";

// Study notes: who can see which notes, and search.

export const NOTES_MAX_MB = 10;

/** Notes visible to this user, or null if none (e.g. parents). */
export async function notesScope(user: CurrentUser): Promise<Prisma.NoteWhereInput | null> {
  if (user.roles.includes("ADMIN")) return {};
  const or: Prisma.NoteWhereInput[] = [{ uploadedById: user.id }];
  const hodDepts = departmentsFor(user, "HOD");
  if (hodDepts.length) or.push({ departmentId: { in: hodDepts } });
  const teacher = await getTeacherProfile(user.id);
  if (teacher) {
    const maps = await db.teacherSubject.findMany({ where: { teacherId: teacher.id }, select: { subjectId: true } });
    or.push({ departmentId: teacher.departmentId }, { subjectId: { in: maps.map((m) => m.subjectId) } });
  }
  if (user.roles.includes("STUDENT")) {
    const s = await db.student.findUnique({ where: { userId: user.id } });
    if (s) or.push({ departmentId: s.departmentId, year: s.year, OR: [{ sectionId: null }, { sectionId: s.sectionId }] });
  }
  return or.length > 1 || teacher || hodDepts.length ? { OR: or } : null;
}

export async function searchNotes(user: CurrentUser, opts: { q?: string; subjectId?: string }) {
  const scope = await notesScope(user);
  if (!scope) return [];
  const q = opts.q?.trim();
  return db.note.findMany({
    where: {
      AND: [
        scope,
        opts.subjectId ? { subjectId: opts.subjectId } : {},
        q
          ? {
              OR: [
                { title: textContains(q) },
                { description: textContains(q) },
                { tags: textContains(q) },
                { fileName: textContains(q) },
                { subject: { name: textContains(q) } },
                { subject: { code: textContains(q.toUpperCase()) } },
              ],
            }
          : {},
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { subject: true, department: { select: { code: true } } },
  });
}

/** Can this user delete the note? Uploader, the department's HOD, or admin. */
export function canDeleteNote(user: CurrentUser, note: { uploadedById: string; departmentId: string }): boolean {
  return note.uploadedById === user.id || user.roles.includes("ADMIN") || departmentsFor(user, "HOD").includes(note.departmentId);
}
