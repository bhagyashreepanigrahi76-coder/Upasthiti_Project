import "server-only";
import type { AssessmentKind, MarksStatus, SubjectType } from "@prisma/client";
import { db } from "./db";
import { getSettings, type AppSettings } from "./settings";
import { notifyUsers } from "./notify";

// Marks, grades and results (PRD §4.5 FR-21..25, §4.7 FR-33).

export const KIND_LABEL: Record<AssessmentKind, string> = {
  INTERNAL1: "Internal 1",
  INTERNAL2: "Internal 2",
  ASSIGNMENT: "Assignment",
  PRACTICAL: "Practical",
  SEMESTER: "Semester exam",
};
export const KIND_ORDER: AssessmentKind[] = ["INTERNAL1", "INTERNAL2", "ASSIGNMENT", "PRACTICAL", "SEMESTER"];
export const STATUS_LABEL: Record<MarksStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  VERIFIED: "Verified",
  LOCKED: "Locked",
  PUBLISHED: "Published",
};

export const schemeFor = (type: SubjectType, settings: AppSettings) => settings.assessmentScheme[type];

/** FR-24: students see results only after the scheduled publish time. */
export function isVisible(a: { status: MarksStatus; publishAt: Date | null }, now = new Date()): boolean {
  return a.status === "PUBLISHED" || (a.status === "LOCKED" && a.publishAt !== null && a.publishAt <= now);
}

export function gradeFor(percent: number, settings: AppSettings) {
  const scale = [...settings.gradeScale].sort((a, b) => b.minPercent - a.minPercent);
  return scale.find((g) => percent >= g.minPercent) ?? scale[scale.length - 1];
}

/** "" = not entered, "AB" = absent, otherwise a number from 0 to max with up to 2 decimals (FR-22). */
export function parseMark(raw: string, max: number): { ok: true; empty: boolean; marks: number | null; absent: boolean } | { ok: false; error: string } {
  const v = raw.trim().toUpperCase();
  if (v === "") return { ok: true, empty: true, marks: null, absent: false };
  if (v === "AB") return { ok: true, empty: false, marks: null, absent: true };
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(v)) return { ok: false, error: `"${raw}" is not a mark (use a number or AB)` };
  const n = Number(v);
  if (n > max) return { ok: false, error: `${n} is above the maximum of ${max}` };
  return { ok: true, empty: false, marks: n, absent: false };
}

export const showMark = (e: { marks: number | null; absent: boolean } | undefined) => (!e ? "" : e.absent ? "AB" : String(e.marks ?? ""));

/** FR-25 class analytics for one assessment. */
export function classStats(entries: { marks: number | null; absent: boolean }[], max: number, passPercent: number) {
  const scored = entries.filter((e) => !e.absent && e.marks !== null).map((e) => e.marks!);
  const passMark = (max * passPercent) / 100;
  const passed = scored.filter((m) => m >= passMark).length;
  return {
    entered: entries.length,
    absent: entries.filter((e) => e.absent).length,
    average: scored.length ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10 : null,
    highest: scored.length ? Math.max(...scored) : null,
    lowest: scored.length ? Math.min(...scored) : null,
    passMark,
    passPercent: entries.length ? Math.round((passed / entries.length) * 1000) / 10 : null,
  };
}

export type ComponentResult = { kind: AssessmentKind; label: string; marks: number | null; absent: boolean; maxMarks: number; weightage: number };
export type SubjectResult = {
  subjectId: string;
  code: string;
  name: string;
  credits: number;
  semester: number;
  components: ComponentResult[];
  final: boolean; // semester exam published
  percent: number | null;
  grade: string | null;
  points: number | null;
  passed: boolean | null;
};
export type SemesterResult = { semester: number; subjects: SubjectResult[]; sgpa: number | null; credits: number };

/** Published results for a student across all semesters (FR-33). */
export async function studentResults(studentId: string): Promise<{ semesters: SemesterResult[]; cgpa: number | null; settings: AppSettings }> {
  const settings = await getSettings();
  const now = new Date();
  const entries = await db.markEntry.findMany({
    where: { studentId },
    include: { assessment: { include: { subject: true } } },
  });
  const visible = entries.filter((e) => isVisible(e.assessment, now));

  const bySubject = new Map<string, SubjectResult>();
  for (const e of visible) {
    const s = e.assessment.subject;
    if (!bySubject.has(s.id)) {
      bySubject.set(s.id, { subjectId: s.id, code: s.code, name: s.name, credits: s.credits, semester: s.semester, components: [], final: false, percent: null, grade: null, points: null, passed: null });
    }
    bySubject.get(s.id)!.components.push({
      kind: e.assessment.kind,
      label: KIND_LABEL[e.assessment.kind],
      marks: e.marks,
      absent: e.absent,
      maxMarks: e.assessment.maxMarks,
      weightage: e.assessment.weightage,
    });
  }

  const subjectTypes = new Map((await db.subject.findMany({ where: { id: { in: [...bySubject.keys()] } }, select: { id: true, type: true } })).map((s) => [s.id, s.type]));
  for (const r of bySubject.values()) {
    r.components.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    const weighted = r.components.reduce((sum, c) => sum + (c.absent || c.marks === null ? 0 : (c.marks / c.maxMarks) * c.weightage), 0);
    const shownWeight = r.components.reduce((sum, c) => sum + c.weightage, 0);
    const fullWeight = schemeFor(subjectTypes.get(r.subjectId) ?? "THEORY", settings).reduce((sum, i) => sum + i.weightage, 0) || 100;
    r.final = r.components.some((c) => c.kind === "SEMESTER");
    const base = r.final ? fullWeight : shownWeight;
    r.percent = base ? Math.round((weighted / base) * 1000) / 10 : null;
    if (r.final && r.percent !== null) {
      const g = gradeFor(r.percent, settings);
      r.grade = g.grade;
      r.points = g.points;
      r.passed = r.percent >= settings.passPercent;
    }
  }

  const semesters = new Map<number, SubjectResult[]>();
  for (const r of bySubject.values()) semesters.set(r.semester, [...(semesters.get(r.semester) ?? []), r]);
  const gpa = (rs: SubjectResult[]) => {
    const finals = rs.filter((r) => r.final && r.points !== null);
    const credits = finals.reduce((a, r) => a + r.credits, 0);
    return { credits, value: credits ? Math.round((finals.reduce((a, r) => a + r.credits * r.points!, 0) / credits) * 100) / 100 : null };
  };
  const out = [...semesters.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([semester, subjects]) => {
      const g = gpa(subjects);
      return { semester, subjects: subjects.sort((a, b) => a.code.localeCompare(b.code)), sgpa: g.value, credits: g.credits };
    });
  return { semesters: out, cgpa: gpa([...bySubject.values()]).value, settings };
}

/** FR-24 job: publishes locked results whose time has come and notifies students and parents once. */
export async function publishDueResults(now = new Date()): Promise<number> {
  const due = await db.assessment.findMany({
    where: { OR: [{ status: "LOCKED", publishAt: { lte: now } }, { status: "PUBLISHED", notifiedAt: null }] },
    include: { subject: true },
  });
  for (const a of due) {
    await db.assessment.update({ where: { id: a.id }, data: { status: "PUBLISHED", publishedAt: a.publishedAt ?? now, notifiedAt: now } });
    await notifyResultPublished(a.sectionId, `${a.subject.code} ${KIND_LABEL[a.kind]}`);
  }
  return due.length;
}

export async function notifyResultPublished(sectionId: string, what: string) {
  const students = await db.student.findMany({
    where: { sectionId, status: "ACTIVE" },
    select: { userId: true, parents: { select: { parent: { select: { userId: true } } } } },
  });
  const title = `Result published: ${what}`;
  await notifyUsers(students.map((s) => s.userId), { title, link: "/student/results" });
  const parentIds = students.flatMap((s) => s.parents.map((p) => p.parent.userId)).filter((x): x is string => !!x);
  await notifyUsers(parentIds, { title, link: "/parent/results" });
}
