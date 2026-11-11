import type { NextRequest } from "next/server";
import { currentUserForApi, departmentsFor } from "@/lib/auth";
import { db } from "@/lib/db";
import { fileResponse, forbidden } from "@/lib/exports";
import { logAudit } from "@/lib/audit";
import { attendanceFor } from "@/lib/attendance";
import { isMonthKey } from "@/lib/dates";

const CODE = { PRESENT: "P", LATE: "L", ABSENT: "A", ON_LEAVE: "LV", MEDICAL: "M" } as const;

// Monthly attendance register for a section: one row per student, one column per class held.
export async function GET(request: NextRequest) {
  const user = await currentUserForApi();
  if (!user) return forbidden();
  const sp = request.nextUrl.searchParams;
  const sectionId = sp.get("section") ?? "";
  const month = sp.get("month") ?? "";
  if (!isMonthKey(month)) return new Response("Choose a month", { status: 400 });
  const section = await db.section.findUnique({ where: { id: sectionId }, include: { department: true } });
  if (!section) return new Response("Section not found", { status: 404 });
  if (!user.roles.includes("ADMIN") && !departmentsFor(user, "HOD").includes(section.departmentId)) return forbidden();

  const [y, m] = month.split("-").map(Number);
  const to = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  const [students, sessions] = await Promise.all([
    db.student.findMany({ where: { sectionId, status: "ACTIVE" }, orderBy: { rollNo: "asc" }, include: { user: { select: { name: true } } } }),
    db.classSession.findMany({
      where: { sectionId, dateKey: { gte: `${month}-01`, lte: to } },
      orderBy: [{ dateKey: "asc" }, { periodNumber: "asc" }],
      include: { subject: true, records: true },
    }),
  ]);
  const totals = await attendanceFor(students.map((s) => s.id), { from: `${month}-01`, to });
  const rows: (string | number | null)[][] = [
    ["Roll no", "Name", ...sessions.map((s) => `${s.dateKey.slice(8)}/${s.dateKey.slice(5, 7)} P${s.periodNumber} ${s.subject?.code ?? ""}`.trim()), "Held", "Attended", "%"],
    ...students.map((st) => {
      const t = totals.get(st.id)!.overall;
      return [
        st.rollNo,
        st.user.name,
        ...sessions.map((s) => {
          const r = s.records.find((x) => x.studentId === st.id);
          return r ? CODE[r.status] : "";
        }),
        t.held,
        t.attended,
        t.percent,
      ];
    }),
  ];
  await logAudit({ actorId: user.id, action: "EXPORT_ATTENDANCE_REGISTER", entityType: "Section", entityId: sectionId, details: { month } });
  return fileResponse(rows, `attendance-${section.department.code}-${section.year}${section.name}-${month}`, sp.get("format") ?? "csv", `${section.department.code} ${section.year}-${section.name} ${month}`);
}
