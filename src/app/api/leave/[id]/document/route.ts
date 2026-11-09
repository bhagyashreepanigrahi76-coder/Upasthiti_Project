import { NextResponse } from "next/server";
import { canApproveForStudent, currentUserForApi } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { readUpload } from "@/lib/uploads";

// Serves a leave document only to the student who uploaded it, the people
// who can approve it (coordinator, HOD) and admins.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUserForApi();
  if (!user) return new NextResponse("Please sign in.", { status: 401 });
  const { id } = await ctx.params;

  const leave = await db.leaveRequest.findUnique({ where: { id }, include: { student: true } });
  if (!leave?.documentPath) return new NextResponse("Not found", { status: 404 });

  const allowed =
    leave.student.userId === user.id || user.roles.includes("ADMIN") || (await canApproveForStudent(user, leave.student));
  if (!allowed) return new NextResponse("Not found", { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await readUpload(leave.documentPath);
  } catch {
    return new NextResponse("File missing", { status: 404 });
  }
  if (leave.student.userId !== user.id) {
    await logAudit({ actorId: user.id, action: "LEAVE_DOCUMENT_VIEWED", entityType: "LeaveRequest", entityId: leave.id });
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": leave.documentMime ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${(leave.documentName ?? "document").replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
