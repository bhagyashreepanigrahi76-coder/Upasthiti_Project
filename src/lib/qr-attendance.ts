import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { findPeriod } from "./class-attendance";
import { logAudit } from "./audit";
import { minutesOfDay, parseHHMM, toDateKey } from "./dates";

// Rotating QR attendance. The teacher's screen shows a QR code that changes
// every 20 seconds; a student scans it and is marked Present for that period.
// Nothing is stored for the QR itself: each code carries a signature (HMAC of
// the date, period and 20-second slot, made with SESSION_SECRET), so the
// server can check it without a database table.

export const QR_SLOT_MS = 20_000;
export const slotAt = (t = Date.now()) => Math.floor(t / QR_SLOT_MS);

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET is missing or shorter than 32 characters. See .env.example.");
  return s;
}

export function signQr(dateKey: string, periodKey: string, slot: number): string {
  return createHmac("sha256", secret()).update(`qr|${dateKey}|${periodKey}|${slot}`).digest("base64url").slice(0, 22);
}

export type QrCheck = "ok" | "expired" | "invalid";

/** A code is valid in its own 20-second slot and in the next one (a short grace for scanning and page load). */
export function verifyQr(dateKey: string, periodKey: string, slot: number, sig: string, now = Date.now()): QrCheck {
  if (!Number.isInteger(slot) || typeof sig !== "string") return "invalid";
  const expected = Buffer.from(signQr(dateKey, periodKey, slot));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "invalid";
  const current = slotAt(now);
  if (slot > current) return "invalid";
  return current - slot > 1 ? "expired" : "ok";
}

/** The page a student's phone opens after scanning (path only; the browser adds the host). */
export function scanPath(dateKey: string, periodKey: string, slot: number): string {
  const q = new URLSearchParams({ d: dateKey, p: periodKey, s: String(slot), k: signQr(dateKey, periodKey, slot) });
  return `/student/scan?${q.toString()}`;
}

export type ScanResult = { ok: boolean; message: string };

/** Marks the student Present for the period named by a valid QR. Safe to call twice. */
export async function markSelfPresent(input: {
  userId: string;
  studentId: string;
  dateKey: string;
  periodKey: string;
  slot: number;
  sig: string;
  /** Only tests pass this; real scans use the current time. */
  now?: Date;
}): Promise<ScanResult> {
  const { userId, studentId, dateKey, periodKey, slot, sig } = input;
  const now = input.now ?? new Date();

  const check = verifyQr(dateKey, periodKey, slot, sig, now.getTime());
  if (check === "invalid") return { ok: false, message: "This QR code is not valid. Scan the code shown on the teacher's screen." };
  if (check === "expired") return { ok: false, message: "This QR code has expired. Scan the new code on the teacher's screen." };
  if (dateKey !== toDateKey(now)) return { ok: false, message: "This QR code is not for today." };

  const found = await findPeriod(dateKey, periodKey);
  if (!found) return { ok: false, message: "This class is not on the timetable today, or it was cancelled." };
  const { sectionId, period } = found;
  if (!period.teacherId) return { ok: false, message: "No teacher is assigned to this period." };

  const minute = minutesOfDay(now);
  if (minute < parseHHMM(period.start) - 10 || minute > parseHHMM(period.end) + 15) {
    return { ok: false, message: `Attendance for this period is open only around its time (${period.start}–${period.end}).` };
  }

  const student = await db.student.findFirst({
    where: { id: studentId, sectionId, status: "ACTIVE", ...(period.batchId ? { batchId: period.batchId } : {}) },
    select: { id: true },
  });
  if (!student) return { ok: false, message: "You are not in this class, so this QR cannot mark your attendance." };

  const teacher = await db.teacher.findUnique({ where: { id: period.teacherId }, select: { id: true, userId: true } });
  if (!teacher) return { ok: false, message: "The teacher for this period was not found." };

  const sessionKey = { dateKey_periodKey: { dateKey, periodKey } };
  let session = await db.classSession.findUnique({ where: sessionKey });
  if (!session) {
    try {
      session = await db.classSession.create({
        data: {
          dateKey,
          periodKey,
          sectionId,
          subjectId: period.subjectId,
          batchId: period.batchId,
          periodNumber: period.periodNumber,
          span: period.span,
          teacherId: teacher.id,
          takenById: teacher.userId,
        },
      });
    } catch {
      // Another student's scan created it a moment ago.
      session = await db.classSession.findUniqueOrThrow({ where: sessionKey });
    }
  }

  const label = `${period.subject}, period ${period.periodNumber}`;
  const existing = await db.attendanceRecord.findUnique({
    where: { classSessionId_studentId: { classSessionId: session.id, studentId } },
  });
  if (existing && (existing.status === "ON_LEAVE" || existing.status === "MEDICAL")) {
    return { ok: true, message: `Your leave is already recorded for ${label}.` };
  }
  if (existing && (existing.status === "PRESENT" || existing.status === "LATE")) {
    return { ok: true, message: `You are already marked present for ${label}.` };
  }

  await db.attendanceRecord.upsert({
    where: { classSessionId_studentId: { classSessionId: session.id, studentId } },
    create: { classSessionId: session.id, studentId, status: "PRESENT", markedById: userId },
    update: { status: "PRESENT", markedById: userId },
  });
  await logAudit({ actorId: userId, action: "ATTENDANCE_QR_SCAN", entityType: "ClassSession", entityId: session.id, details: { dateKey, periodKey } });
  return { ok: true, message: `You are marked present for ${label}.` };
}
