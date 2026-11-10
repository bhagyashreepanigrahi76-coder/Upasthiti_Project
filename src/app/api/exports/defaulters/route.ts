import type { NextRequest } from "next/server";
import { currentUserForApi, departmentsFor } from "@/lib/auth";
import { analytics } from "@/lib/analytics";
import { fileResponse, forbidden } from "@/lib/exports";
import { logAudit } from "@/lib/audit";
import { toDateKey } from "@/lib/dates";

// Defaulters list: admin for any departments, HOD for their own only.
export async function GET(request: NextRequest) {
  const user = await currentUserForApi();
  if (!user) return forbidden();
  const asked = request.nextUrl.searchParams.get("dept")?.split(",").filter(Boolean) ?? null;
  let departmentIds: string[] | null;
  if (user.roles.includes("ADMIN")) departmentIds = asked;
  else {
    const mine = departmentsFor(user, "HOD");
    if (!mine.length) return forbidden();
    departmentIds = asked ? asked.filter((d) => mine.includes(d)) : mine;
    if (!departmentIds.length) return forbidden();
  }
  const a = await analytics(departmentIds);
  const rows = [
    ["Roll no", "Name", "Class", "Attendance %", "Classes held", "Status"],
    ...a.defaulters.map((d) => [d.rollNo, d.name, d.className, d.percent, d.held, d.risk === "CRITICAL" ? "Critical" : "Warning"]),
  ];
  await logAudit({ actorId: user.id, action: "EXPORT_DEFAULTERS", details: { departmentIds, rows: a.defaulters.length } });
  return fileResponse(rows, `defaulters-${toDateKey(new Date())}`, request.nextUrl.searchParams.get("format") ?? "csv", "Defaulters");
}
