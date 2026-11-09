import { NextResponse, type NextRequest } from "next/server";
import { currentUserForApi } from "@/lib/auth";
import { db } from "@/lib/db";
import { processPunch, punchInputSchema } from "@/lib/punch";

// POST /api/punch: punch in/out or a dry-run status check (FR-7, FR-31).
// Called by the student app with fetch, including queued offline punches.
export async function POST(request: NextRequest) {
  // Same-origin only (the session cookie is SameSite=Lax, this is a second guard).
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) {
    return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  }

  const user = await currentUserForApi();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  if (!user.roles.includes("STUDENT")) return NextResponse.json({ error: "Only students can punch." }, { status: 403 });

  const student = await db.student.findUnique({
    where: { userId: user.id },
    select: { id: true, userId: true, departmentId: true, year: true, status: true },
  });
  if (!student || student.status !== "ACTIVE") {
    return NextResponse.json({ error: "Your student record is not active." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = punchInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid punch data." }, { status: 400 });

  const result = await processPunch(student, parsed.data, request.headers.get("user-agent"));
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
