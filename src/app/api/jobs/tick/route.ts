import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { runScheduledJobs } from "@/lib/jobs";

// Scheduled tick. Call every 10-15 minutes from a scheduler:
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/jobs/tick
// Closes missed punch-outs after the cut-off (FR-10), publishes results whose
// time has come (FR-24), delivers scheduled notices (FR-47/48) and sends
// punch-in reminders (FR-35).
function authorised(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const result = await runScheduledJobs();
  await db.auditLog.create({ data: { action: "SCHEDULED_JOBS_RUN", details: JSON.stringify(result) } });
  return NextResponse.json(result);
}
