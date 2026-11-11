import { NextResponse } from "next/server";
import { currentUserForApi } from "@/lib/auth";
import { toCsv } from "@/lib/spreadsheet";
import { STUDENT_COLUMNS, TEACHER_COLUMNS } from "@/lib/importers";

// Downloadable CSV templates for bulk import (FR-2). Admin only.
export async function GET(_req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const user = await currentUserForApi();
  if (!user?.roles.includes("ADMIN")) return new NextResponse("Forbidden", { status: 403 });
  const { kind } = await ctx.params;

  const csv =
    kind === "teachers.csv"
      ? toCsv([
          [...TEACHER_COLUMNS],
          ["Priya Raman", "T1050", "BCA", "priya.raman@college.example.edu", "+91 90000 11111", "Assistant Professor", "TEACHER", ""],
          ["Vikram Shah", "T1051", "BCA", "vikram.shah@college.example.edu", "", "Associate Professor", "TEACHER;MENTOR", "1-B"],
        ])
      : kind === "students.csv"
        ? toCsv([
            [...STUDENT_COLUMNS],
            ["Asha Kumar", "S26BCA101", "1", "BCA", "A", "Ravi Kumar", "ravi.kumar@example.com", "+91 90000 22222", "", "", "2026", "2008-04-17", "Batch 1"],
            ["Imran Ali", "S26BCA102", "1", "BCA", "B", "Farah Ali", "farah.ali@example.com", "", "imran@example.com", "", "", "17/09/2008", ""],
          ])
        : null;
  if (!csv) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kind}"`,
      "Cache-Control": "no-store",
    },
  });
}
