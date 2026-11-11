"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { saveSettings, settingsSchema } from "@/lib/settings";
import { type ActionState, failure, formValues, fromZodError, success } from "@/lib/action-state";

const fenceSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Name the location, e.g. Main gate").max(80),
  latitude: z.coerce.number().min(-90, "Latitude is -90 to 90").max(90, "Latitude is -90 to 90"),
  longitude: z.coerce.number().min(-180, "Longitude is -180 to 180").max(180, "Longitude is -180 to 180"),
  radiusMeters: z.coerce.number().int().min(20, "At least 20 m").max(2000, "At most 2000 m"),
});

export async function saveGeofence(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const parsed = fenceSchema.safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { id, ...data } = parsed.data;
  const fence = id ? await db.geofence.update({ where: { id }, data }) : await db.geofence.create({ data });
  await logAudit({ actorId: admin.id, action: id ? "GEOFENCE_UPDATED" : "GEOFENCE_CREATED", entityType: "Geofence", entityId: fence.id, details: data });
  refresh();
  return success(id ? "Campus point updated." : "Campus point added.");
}

export async function toggleGeofence(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const fence = await db.geofence.findUnique({ where: { id } });
  if (!fence) return failure("Not found.");
  await db.geofence.update({ where: { id }, data: { isActive: !fence.isActive } });
  await logAudit({ actorId: admin.id, action: fence.isActive ? "GEOFENCE_DISABLED" : "GEOFENCE_ENABLED", entityType: "Geofence", entityId: id });
  refresh();
  return success("Saved.");
}

export async function deleteGeofence(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  await db.geofence.delete({ where: { id } }).catch(() => null);
  await logAudit({ actorId: admin.id, action: "GEOFENCE_DELETED", entityType: "Geofence", entityId: id });
  refresh();
  return success("Campus point deleted.");
}

/** Punch rules, college hours and attendance thresholds (FR-13, FR-27, FR-41). */
export async function savePunchSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const v = formValues(formData);
  const input = {
    ...v,
    workingDays: formData.getAll("workingDays").map(Number),
    enforceSchedule: formData.get("enforceSchedule") === "on",
    requireDeviceBinding: formData.get("requireDeviceBinding") === "on",
    allowMultipleSessions: formData.get("allowMultipleSessions") === "on",
    requireCampusPunch: formData.get("requireCampusPunch") === "on",
  };
  const parsed = settingsSchema
    .pick({
      collegeStart: true, collegeEnd: true, punchCutoff: true, earlyArrivalMinutes: true, workingDays: true,
      enforceSchedule: true, requireDeviceBinding: true, allowMultipleSessions: true,
      requireCampusPunch: true, attendanceEditHours: true,
      maxAccuracyMeters: true, toleranceMeters: true, maxClockSkewMinutes: true, offlineSyncLimitHours: true, maxSpeedKmh: true,
      warningThreshold: true, criticalThreshold: true, leavePolicy: true,
    })
    .refine((s) => s.collegeEnd > s.collegeStart, { path: ["collegeEnd"], message: "Must be after the start time" })
    .refine((s) => s.punchCutoff >= s.collegeEnd, { path: ["punchCutoff"], message: "Must be at or after college end" })
    .refine((s) => s.criticalThreshold < s.warningThreshold, { path: ["criticalThreshold"], message: "Must be below the warning level" })
    .refine((s) => s.workingDays.length > 0, { path: ["workingDays"], message: "Pick at least one day" })
    .safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  await saveSettings(parsed.data);
  await logAudit({ actorId: admin.id, action: "SETTINGS_UPDATED", entityType: "Setting", details: parsed.data });
  refresh();
  return success("Settings saved.");
}
