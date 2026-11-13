"use server";

import { getTeacherProfile, requireStudent, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { findPeriod, rosterFor } from "@/lib/class-attendance";
import { isDateKey, toDateKey } from "@/lib/dates";
import { QR_SLOT_MS, markSelfPresent, scanPath, slotAt, type ScanResult } from "@/lib/qr-attendance";

export type QrLink =
  | { ok: true; path: string; slot: number; serverNow: number; expiresAt: number; present: number; total: number }
  | { ok: false; error: string };

/** Teacher's screen: the current QR link for a period, plus how many students have scanned. */
export async function currentQrLink(dateKey: string, periodKey: string): Promise<QrLink> {
  const user = await requireUser();
  if (!isDateKey(dateKey)) return { ok: false, error: "Invalid date." };
  if (dateKey !== toDateKey(new Date())) return { ok: false, error: "The QR code works only on the day of the class." };

  const found = await findPeriod(dateKey, periodKey);
  const teacher = await getTeacherProfile(user.id);
  if (!found || !teacher || found.period.teacherId !== teacher.id) {
    return { ok: false, error: "Only the teacher taking this period can show its QR code." };
  }

  const [roster, session] = await Promise.all([
    rosterFor(found.sectionId, found.period.batchId),
    db.classSession.findUnique({
      where: { dateKey_periodKey: { dateKey, periodKey } },
      include: { records: { select: { status: true } } },
    }),
  ]);
  const present = session ? session.records.filter((r) => r.status === "PRESENT" || r.status === "LATE").length : 0;

  const serverNow = Date.now();
  const slot = slotAt(serverNow);
  return { ok: true, path: scanPath(dateKey, periodKey, slot), slot, serverNow, expiresAt: (slot + 1) * QR_SLOT_MS, present, total: roster.length };
}

/** Student's phone: mark the signed-in student present using the scanned QR. */
export async function scanAttendance(dateKey: string, periodKey: string, slot: number, sig: string): Promise<ScanResult> {
  const { user, student } = await requireStudent();
  if (!isDateKey(dateKey) || typeof periodKey !== "string" || periodKey.length > 60) {
    return { ok: false, message: "This QR code is not valid." };
  }
  return markSelfPresent({ userId: user.id, studentId: student.id, dateKey, periodKey, slot: Number(slot), sig: String(sig) });
}
