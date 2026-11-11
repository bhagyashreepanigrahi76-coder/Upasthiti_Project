import type { NextRequest } from "next/server";
import { currentUserForApi } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditWhere } from "@/lib/audit-query";
import { fileResponse, forbidden } from "@/lib/exports";
import { logAudit } from "@/lib/audit";

// FR-30 audit log export (admin only), using the same filters as the page.
export async function GET(request: NextRequest) {
  const user = await currentUserForApi();
  if (!user?.roles.includes("ADMIN")) return forbidden();
  const sp = Object.fromEntries(request.nextUrl.searchParams.entries());
  const rows = await db.auditLog.findMany({ where: await auditWhere(sp), orderBy: { createdAt: "desc" }, take: 50_000, include: { actor: { select: { collegeId: true, name: true } } } });
  await logAudit({ actorId: user.id, action: "EXPORT_AUDIT_LOG", details: { rows: rows.length, filters: sp } });
  return fileResponse(
    [["Time (UTC)", "College ID", "Name", "Action", "Record type", "Record ID", "Details", "IP"], ...rows.map((r) => [r.createdAt.toISOString(), r.actor?.collegeId ?? "", r.actor?.name ?? "System", r.action, r.entityType ?? "", r.entityId ?? "", r.details ?? "", r.ipAddress ?? ""])],
    "audit-log",
    sp.format ?? "csv",
    "Audit log",
  );
}
