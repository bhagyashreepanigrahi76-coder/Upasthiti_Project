import { NextResponse } from "next/server";
import { connection } from "next/server";
import { db } from "@/lib/db";

// Uptime check for monitoring (PRD §7: 99.5 % availability during college hours).
// Returns 200 when the app can reach the database; reveals nothing else.
export async function GET() {
  await connection();
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
