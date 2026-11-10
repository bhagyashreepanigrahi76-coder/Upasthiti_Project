"use server";

import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { type ActionState, failure, success } from "@/lib/action-state";

/**
 * FR-28 year-end promotion: Year 1 and 2 students move up into the same-named
 * sections of the next academic year; Year 3 students are marked passed out
 * and their sign-in is turned off. Every record (attendance, marks, punches)
 * is kept. Runs once per target year.
 */
export async function promoteStudents(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  if (String(formData.get("confirm") ?? "").trim().toUpperCase() !== "PROMOTE") {
    return { error: "Type PROMOTE to confirm.", fieldErrors: { confirm: "Type PROMOTE" } };
  }
  const targetId = String(formData.get("targetYearId") ?? "");
  const [current, target] = await Promise.all([
    db.academicYear.findFirst({ where: { isCurrent: true } }),
    db.academicYear.findUnique({ where: { id: targetId } }),
  ]);
  if (!current || !target) return failure("Choose the next academic year (create it in Academic setup first).");
  if (target.startDate <= current.startDate) return failure("The target year must start after the current year.");
  const alreadyThere = await db.student.count({ where: { section: { academicYearId: target.id } } });
  if (alreadyThere > 0) return failure(`Students are already in ${target.name}. Promotion has run for that year.`);

  const sections = await db.section.findMany({ where: { academicYearId: current.id } });
  const result = await db.$transaction(async (tx) => {
    let promoted = 0;
    let graduated = 0;
    const sectionFor = new Map<string, string>();
    // Same-named sections in the new year: Year 2 and 3 for promoted students, Year 1 for new admissions.
    for (const s of sections) {
      const nextYear = s.year + 1;
      for (const year of [nextYear, ...(s.year === 1 ? [1] : [])]) {
        if (year > 3) continue;
        const created = await tx.section.upsert({
          where: { departmentId_academicYearId_year_name: { departmentId: s.departmentId, academicYearId: target.id, year, name: s.name } },
          create: { departmentId: s.departmentId, academicYearId: target.id, year, name: s.name },
          update: {},
        });
        if (year === nextYear) sectionFor.set(s.id, created.id);
      }
    }
    const students = await tx.student.findMany({ where: { status: "ACTIVE", sectionId: { in: sections.map((s) => s.id) } } });
    for (const st of students) {
      if (st.year >= 3) {
        await tx.student.update({ where: { id: st.id }, data: { status: "PASSED_OUT", mentorId: null, batchId: null } });
        await tx.user.update({ where: { id: st.userId }, data: { isActive: false, sessionVersion: { increment: 1 } } });
        graduated++;
      } else {
        const sectionId = sectionFor.get(st.sectionId)!;
        await tx.student.update({ where: { id: st.id }, data: { sectionId, year: st.year + 1, batchId: null, mentorId: null } });
        await tx.userRole.updateMany({ where: { userId: st.userId, role: "STUDENT" }, data: { sectionId, year: st.year + 1 } });
        promoted++;
      }
    }
    if (formData.get("makeCurrent") === "on") {
      await tx.academicYear.updateMany({ data: { isCurrent: false } });
      await tx.academicYear.update({ where: { id: target.id }, data: { isCurrent: true } });
    }
    return { promoted, graduated };
  });

  await logAudit({ actorId: admin.id, action: "YEAR_END_PROMOTION", entityType: "AcademicYear", entityId: target.id, details: { from: current.name, to: target.name, ...result } });
  refresh();
  return success(
    `${result.promoted} students promoted and ${result.graduated} marked as passed out (records kept). Next: map teachers to subjects, assign class coordinators and set up timetables for ${target.name}.`,
  );
}
