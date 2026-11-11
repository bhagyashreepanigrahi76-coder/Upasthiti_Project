// Notice audience rules (FR-44, FR-50), kept free of database and framework
// imports so they can be unit-tested.

export type Scope = { departmentId: string; year: number; sectionId: string; subjectIds: string[] };
export type TeacherScope = { departmentId: string; sectionIds: string[]; subjectIds: string[] };
export type AudienceContext = { userId: string; isAdmin: boolean; student: Scope | null; children: Scope[]; teacher: TeacherScope | null };
export type NoticeScope = {
  audience: "EVERYONE" | "STUDENTS" | "TEACHERS" | "PARENTS";
  departmentId: string | null;
  year: number | null;
  sectionId: string | null;
  subjectId: string | null;
  createdById: string;
};

export const inScope = (n: NoticeScope, s: Scope) =>
  (!n.departmentId || n.departmentId === s.departmentId) &&
  (!n.year || n.year === s.year) &&
  (!n.sectionId || n.sectionId === s.sectionId) &&
  (!n.subjectId || s.subjectIds.includes(n.subjectId));

export const teacherInScope = (n: NoticeScope, t: TeacherScope) =>
  (!n.departmentId || n.departmentId === t.departmentId) &&
  (!n.sectionId || t.sectionIds.includes(n.sectionId)) &&
  (!n.subjectId || t.subjectIds.includes(n.subjectId));

export function canSee(n: NoticeScope, ctx: AudienceContext): boolean {
  if (ctx.isAdmin || n.createdById === ctx.userId) return true;
  const asStudent = ctx.student ? inScope(n, ctx.student) : false;
  const asParent = ctx.children.some((c) => inScope(n, c));
  const asTeacher = ctx.teacher ? teacherInScope(n, ctx.teacher) : false;
  switch (n.audience) {
    case "EVERYONE":
      return asStudent || asParent || asTeacher;
    case "STUDENTS":
      return asStudent;
    case "PARENTS":
      return asParent;
    case "TEACHERS":
      return asTeacher;
  }
}
