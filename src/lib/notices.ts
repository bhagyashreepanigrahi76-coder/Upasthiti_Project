import "server-only";
import type { Notice, NoticeCategory, Prisma } from "@prisma/client";
import { db } from "./db";
import { departmentsFor, getTeacherProfile, type CurrentUser } from "./auth";
import { getSettings } from "./settings";
import { notifyUsers } from "./notify";
import { enqueueEmails } from "./email-queue";
import { APP_NAME } from "./config";
import { textContains } from "./db-search";
import { canSee, type AudienceContext, type TeacherScope } from "./audience";

export { canSee, type AudienceContext };

// Announcements and notice board (PRD §4.9).

export const CATEGORY_LABEL: Record<NoticeCategory, string> = {
  EXAM: "Exam",
  RESULT: "Result",
  HOLIDAY: "Holiday",
  EVENT: "Event",
  TIMETABLE: "Timetable",
  PLACEMENT: "Placement",
  GENERAL: "General",
};

async function subjectIdsForSection(sectionId: string): Promise<string[]> {
  const m = await db.teacherSubject.findMany({ where: { sectionId }, select: { subjectId: true } });
  return [...new Set(m.map((x) => x.subjectId))];
}

/** Who the user is, for audience matching (FR-44). */
export async function audienceContext(user: CurrentUser): Promise<AudienceContext> {
  const [student, parent, teacher] = await Promise.all([
    user.roles.includes("STUDENT") ? db.student.findUnique({ where: { userId: user.id } }) : null,
    user.roles.includes("PARENT") ? db.parent.findUnique({ where: { userId: user.id }, include: { students: { include: { student: true } } } }) : null,
    getTeacherProfile(user.id),
  ]);
  const scopeOf = async (s: { departmentId: string; year: number; sectionId: string }) => ({
    departmentId: s.departmentId,
    year: s.year,
    sectionId: s.sectionId,
    subjectIds: await subjectIdsForSection(s.sectionId),
  });
  let teacherScope: TeacherScope | null = null;
  if (teacher) {
    const maps = await db.teacherSubject.findMany({ where: { teacherId: teacher.id } });
    teacherScope = { departmentId: teacher.departmentId, sectionIds: maps.map((m) => m.sectionId), subjectIds: maps.map((m) => m.subjectId) };
  }
  return {
    userId: user.id,
    isAdmin: user.roles.includes("ADMIN"),
    student: student ? await scopeOf(student) : null,
    children: parent ? await Promise.all(parent.students.map((l) => scopeOf(l.student))) : [],
    teacher: teacherScope,
  };
}

const liveWhere = (now: Date): Prisma.NoticeWhereInput => ({ status: "PUBLISHED", publishAt: { lte: now } });
const currentWhere = (now: Date): Prisma.NoticeWhereInput => ({ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });

const listInclude = {
  createdBy: { select: { name: true } },
  calendarEvent: true,
} satisfies Prisma.NoticeInclude;

export type NoticeFilters = { archive?: boolean; q?: string; category?: NoticeCategory; from?: Date; to?: Date; limit?: number };

/** Notices this user can see: current ones, or the archive (FR-47, FR-51). Pinned first. */
export async function visibleNotices(user: CurrentUser, f: NoticeFilters = {}) {
  const now = new Date();
  const ctx = await audienceContext(user);
  const rows = await db.notice.findMany({
    where: {
      AND: [
        liveWhere(now),
        f.archive ? { expiresAt: { lte: now } } : currentWhere(now),
        f.q ? { OR: [{ title: textContains(f.q) }, { body: textContains(f.q) }] } : {},
        f.category ? { category: f.category } : {},
        f.from ? { publishAt: { gte: f.from } } : {},
        f.to ? { publishAt: { lt: f.to } } : {},
      ],
    },
    orderBy: [{ pinned: "desc" }, { publishAt: "desc" }],
    take: 300,
    include: { ...listInclude, reads: { where: { userId: user.id }, select: { readAt: true } } },
  });
  return rows.filter((n) => canSee(n, ctx)).slice(0, f.limit ?? 100);
}

/** FR-42: notices marked public, for the public board and the login page. */
export function publicNotices(limit = 10) {
  const now = new Date();
  return db.notice.findMany({
    where: { AND: [liveWhere(now), currentWhere(now), { isPublic: true, audience: "EVERYONE" }] },
    orderBy: [{ pinned: "desc" }, { publishAt: "desc" }],
    take: limit,
    include: listInclude,
  });
}

export type PostRights = { level: "admin" | "hod" | "teacher"; departments: string[]; sectionIds: string[]; subjectIds: string[] } | null;

/** FR-50: admin posts college-wide; HOD for own department; teachers only if allowed. */
export async function postRights(user: CurrentUser): Promise<PostRights> {
  if (user.roles.includes("ADMIN")) return { level: "admin", departments: [], sectionIds: [], subjectIds: [] };
  const hodDepts = departmentsFor(user, "HOD");
  if (hodDepts.length) return { level: "hod", departments: hodDepts, sectionIds: [], subjectIds: [] };
  const settings = await getSettings();
  const teacher = await getTeacherProfile(user.id);
  if (teacher && settings.teachersCanPostNotices) {
    const maps = await db.teacherSubject.findMany({ where: { teacherId: teacher.id } });
    return { level: "teacher", departments: [teacher.departmentId], sectionIds: [...new Set(maps.map((m) => m.sectionId))], subjectIds: [...new Set(maps.map((m) => m.subjectId))] };
  }
  return null;
}

/** Everyone a notice is for: user IDs (in-app) and email addresses. */
async function recipients(n: Notice): Promise<{ userIds: string[]; emails: string[] }> {
  let sectionIds: string[] | undefined;
  if (n.subjectId) sectionIds = (await db.teacherSubject.findMany({ where: { subjectId: n.subjectId }, select: { sectionId: true } })).map((m) => m.sectionId);
  const wantStudents = n.audience === "EVERYONE" || n.audience === "STUDENTS" || n.audience === "PARENTS";
  const students = wantStudents
    ? await db.student.findMany({
        where: {
          status: "ACTIVE",
          ...(n.departmentId ? { departmentId: n.departmentId } : {}),
          ...(n.year ? { year: n.year } : {}),
          ...(n.sectionId ? { sectionId: n.sectionId } : sectionIds ? { sectionId: { in: sectionIds } } : {}),
        },
        include: { user: { select: { id: true, email: true } }, parents: { include: { parent: true } } },
      })
    : [];
  const teachers =
    n.audience === "EVERYONE" || n.audience === "TEACHERS"
      ? await db.teacher.findMany({
          where: {
            ...(n.departmentId ? { departmentId: n.departmentId } : {}),
            ...(n.sectionId || n.subjectId
              ? { subjects: { some: { ...(n.sectionId ? { sectionId: n.sectionId } : {}), ...(n.subjectId ? { subjectId: n.subjectId } : {}) } } }
              : {}),
          },
          include: { user: { select: { id: true, email: true } } },
        })
      : [];

  const userIds: string[] = [];
  const emails: string[] = [];
  if (n.audience !== "PARENTS") {
    for (const s of students) {
      userIds.push(s.user.id);
      if (s.user.email) emails.push(s.user.email);
    }
  }
  if (n.audience === "EVERYONE" || n.audience === "PARENTS") {
    for (const s of students) {
      for (const p of s.parents) {
        if (p.parent.userId) userIds.push(p.parent.userId);
        // FR-40: parents can opt out of non-critical email; urgent notices still go.
        if (!p.parent.unsubscribedNonCritical || n.urgent) emails.push(p.parent.email);
      }
    }
  }
  for (const t of teachers) {
    userIds.push(t.user.id);
    if (t.user.email) emails.push(t.user.email);
  }
  return { userIds: [...new Set(userIds)], emails: [...new Set(emails)] };
}

/** FR-48: in-app notification (and optional email) when a notice goes live. Runs once. */
export async function deliverNotice(noticeId: string): Promise<number> {
  const claimed = await db.notice.updateMany({ where: { id: noticeId, notifiedAt: null }, data: { notifiedAt: new Date() } });
  if (claimed.count === 0) return 0;
  const n = await db.notice.findUniqueOrThrow({ where: { id: noticeId } });
  const { userIds, emails } = await recipients(n);
  const title = `${n.urgent ? "URGENT: " : ""}${n.title}`;
  await notifyUsers(userIds, { title, body: `${CATEGORY_LABEL[n.category]} notice`, link: `/notices/${n.id}` });
  if (n.emailOnPublish) {
    // Queued and retried by the tick job (FR-39).
    await enqueueEmails(
      emails.map((to) => ({
        kind: "NOTICE" as const,
        to,
        subject: `${APP_NAME}: ${title}`,
        text: `${n.title}\n\n${n.body}\n\nSign in to see attachments and details.`,
        priority: n.urgent ? 2 : 0,
      })),
    );
  }
  return userIds.length;
}

/** Scheduled notices whose publish time has come (called by the tick job). */
export async function deliverDueNotices(now = new Date()): Promise<number> {
  const due = await db.notice.findMany({ where: { status: "PUBLISHED", publishAt: { lte: now }, notifiedAt: null, notifyOnPublish: true }, select: { id: true } });
  for (const d of due) await deliverNotice(d.id);
  return due.length;
}

/** FR-52: how many people in a notice's audience have opened it. */
export async function readStats(n: Notice): Promise<{ read: number; audience: number }> {
  const [{ userIds }, read] = await Promise.all([recipients(n), db.noticeRead.count({ where: { noticeId: n.id } })]);
  return { read, audience: userIds.length };
}
