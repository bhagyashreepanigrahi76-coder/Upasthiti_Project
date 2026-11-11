import "server-only";
import { cache } from "react";
import { z } from "zod";
import { db } from "./db";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)");

const schemeItem = z.object({
  kind: z.enum(["INTERNAL1", "INTERNAL2", "ASSIGNMENT", "PRACTICAL", "SEMESTER"]),
  maxMarks: z.number().int().min(1).max(200),
  weightage: z.number().int().min(0).max(100),
});
export type SchemeItem = z.infer<typeof schemeItem>;

// Every admin-editable setting, with its default. Stored one row per key in
// the Setting table as JSON (FR-27).
export const settingsSchema = z.object({
  // Attendance thresholds (FR-38, FR-41) and leave policy (FR-17)
  warningThreshold: z.coerce.number().int().min(1).max(100),
  criticalThreshold: z.coerce.number().int().min(1).max(100),
  leavePolicy: z.enum(["EXCLUDE_FROM_DENOMINATOR", "COUNT_AS_PRESENT"]),
  // Geofence (FR-5, FR-8)
  maxAccuracyMeters: z.coerce.number().int().min(5).max(500),
  toleranceMeters: z.coerce.number().int().min(0).max(100),
  // College hours and working days (FR-13, FR-10)
  collegeStart: hhmm,
  collegeEnd: hhmm,
  punchCutoff: hhmm,
  earlyArrivalMinutes: z.coerce.number().int().min(0).max(180),
  workingDays: z.array(z.coerce.number().int().min(1).max(7)),
  enforceSchedule: z.boolean(), // admin override for FR-13
  // Punch rules (FR-4, FR-9, FR-12, business rules §6)
  requireDeviceBinding: z.boolean(),
  allowMultipleSessions: z.boolean(),
  maxClockSkewMinutes: z.coerce.number().int().min(1).max(60),
  offlineSyncLimitHours: z.coerce.number().int().min(1).max(72),
  maxSpeedKmh: z.coerce.number().int().min(20).max(1000),
  // Uploads (FR-46, FR-17)
  uploadMaxMb: z.coerce.number().int().min(1).max(5),
  // Class attendance (§4.3, FR-20)
  requireCampusPunch: z.boolean(), // present only with a campus punch that day
  attendanceEditHours: z.coerce.number().int().min(1).max(168),
  // Marks and results (FR-21, FR-33, PRD Q6)
  assessmentScheme: z.object({ THEORY: z.array(schemeItem), PRACTICAL: z.array(schemeItem) }),
  gradeScale: z.array(z.object({ grade: z.string().min(1).max(3), minPercent: z.number().min(0).max(100), points: z.number().min(0).max(10) })),
  passPercent: z.coerce.number().int().min(1).max(100),
  showGpa: z.boolean(),
  // Notices (FR-50)
  teachersCanPostNotices: z.boolean(),
  noticeApprovalRequired: z.boolean(),
  // Parent reports (FR-36..41)
  reportDayOfMonth: z.coerce.number().int().min(1).max(28),
  reportsPaused: z.boolean(),
  copyCoordinatorOnCritical: z.boolean(),
  smsOnCritical: z.boolean(),
  // Library
  libraryLoanDays: z.coerce.number().int().min(1).max(90),
  libraryFinePerDay: z.coerce.number().int().min(0).max(100),
  libraryMaxBooks: z.coerce.number().int().min(1).max(20),
  libraryMaxRenewals: z.coerce.number().int().min(0).max(5),
});

export type AppSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  warningThreshold: 75,
  criticalThreshold: 30,
  leavePolicy: "EXCLUDE_FROM_DENOMINATOR",
  maxAccuracyMeters: 30,
  toleranceMeters: 0,
  collegeStart: "08:30",
  collegeEnd: "17:00",
  punchCutoff: "18:00",
  earlyArrivalMinutes: 60,
  workingDays: [1, 2, 3, 4, 5], // Saturdays are working only when the calendar says so
  enforceSchedule: true,
  requireDeviceBinding: true,
  allowMultipleSessions: false,
  maxClockSkewMinutes: 5,
  offlineSyncLimitHours: 12,
  maxSpeedKmh: 150,
  uploadMaxMb: 5,
  requireCampusPunch: true,
  attendanceEditHours: 24,
  assessmentScheme: {
    THEORY: [
      { kind: "INTERNAL1", maxMarks: 25, weightage: 15 },
      { kind: "INTERNAL2", maxMarks: 25, weightage: 15 },
      { kind: "ASSIGNMENT", maxMarks: 10, weightage: 10 },
      { kind: "SEMESTER", maxMarks: 100, weightage: 60 },
    ],
    PRACTICAL: [
      { kind: "ASSIGNMENT", maxMarks: 10, weightage: 10 },
      { kind: "PRACTICAL", maxMarks: 50, weightage: 40 },
      { kind: "SEMESTER", maxMarks: 50, weightage: 50 },
    ],
  },
  gradeScale: [
    { grade: "O", minPercent: 90, points: 10 },
    { grade: "A+", minPercent: 80, points: 9 },
    { grade: "A", minPercent: 70, points: 8 },
    { grade: "B+", minPercent: 60, points: 7 },
    { grade: "B", minPercent: 55, points: 6 },
    { grade: "C", minPercent: 50, points: 5 },
    { grade: "P", minPercent: 40, points: 4 },
    { grade: "F", minPercent: 0, points: 0 },
  ],
  passPercent: 40,
  showGpa: true,
  teachersCanPostNotices: false,
  noticeApprovalRequired: true,
  reportDayOfMonth: 1,
  reportsPaused: false,
  copyCoordinatorOnCritical: true,
  smsOnCritical: true,
  libraryLoanDays: 14,
  libraryFinePerDay: 2,
  libraryMaxBooks: 3,
  libraryMaxRenewals: 1,
};

/** Current settings, defaults filled in. Cached per request. */
export const getSettings = cache(async (): Promise<AppSettings> => {
  const rows = await db.setting.findMany();
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key in DEFAULT_SETTINGS) {
      try {
        merged[row.key] = JSON.parse(row.value);
      } catch {
        // ignore a corrupt value and keep the default
      }
    }
  }
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
});

export async function saveSettings(partial: Partial<AppSettings>): Promise<void> {
  await db.$transaction(
    Object.entries(partial).map(([key, value]) =>
      db.setting.upsert({
        where: { key },
        create: { key, value: JSON.stringify(value) },
        update: { value: JSON.stringify(value) },
      }),
    ),
  );
}
