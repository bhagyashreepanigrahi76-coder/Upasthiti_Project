import type { NextRequest } from "next/server";
import { currentUserForApi, departmentsFor, getTeacherProfile } from "@/lib/auth";
import { db } from "@/lib/db";
import { fileResponse, forbidden } from "@/lib/exports";
import { KIND_LABEL } from "@/lib/results";

// Marks sheet for one assessment: admin, the department's HOD, or the subject teacher.
export async function GET(request: NextRequest, ctx: { params: Promise<{ assessmentId: string }> }) {
  const user = await currentUserForApi();
  if (!user) return forbidden();
  const { assessmentId } = await ctx.params;
  const a = await db.assessment.findUnique({ where: { id: assessmentId }, include: { subject: true, section: { include: { department: true } }, marks: true } });
  if (!a) return new Response("Not found", { status: 404 });
  const teacher = await getTeacherProfile(user.id);
  const teaches = teacher ? await db.teacherSubject.findFirst({ where: { teacherId: teacher.id, subjectId: a.subjectId, sectionId: a.sectionId } }) : null;
  if (!user.roles.includes("ADMIN") && !departmentsFor(user, "HOD").includes(a.section.departmentId) && !teaches) return forbidden();
  const students = await db.student.findMany({ where: { sectionId: a.sectionId }, orderBy: { rollNo: "asc" }, include: { user: { select: { name: true } } } });
  const rows = [
    ["Roll no", "Name", `${a.subject.code} ${KIND_LABEL[a.kind]} (max ${a.maxMarks})`, "Status"],
    ...students.map((s) => {
      const e = a.marks.find((m) => m.studentId === s.id);
      return [s.rollNo, s.user.name, e ? (e.absent ? "AB" : e.marks) : "", a.status];
    }),
  ];
  return fileResponse(rows, `marks-${a.subject.code}-${a.kind}-${a.section.department.code}${a.section.year}${a.section.name}`, request.nextUrl.searchParams.get("format") ?? "xlsx", "Marks");
}
