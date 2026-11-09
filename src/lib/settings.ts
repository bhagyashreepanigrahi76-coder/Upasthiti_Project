import "server-only";
import { cache } from "react";
import { z } from "zod";
import { db } from "./db";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)");

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
