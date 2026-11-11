import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { autoCloseSessions } from "@/lib/punch";
import { db } from "@/lib/db";

// FR-10 scheduled job. Call from a scheduler (cron, Vercel Cron, Task
// Scheduler) a few minutes after the punch cut-off, e.g. 18:05 daily:
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/jobs/close-sessions
function authorised(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || secret.length < 16) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const closed = await autoCloseSessions();
  await db.auditLog.create({ data: { action: "SESSIONS_AUTO_CLOSED", details: JSON.stringify({ closed, trigger: "schedule" }) } });
  return NextResponse.json({ closed });
}
