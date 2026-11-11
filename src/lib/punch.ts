import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { PunchStatus, Student } from "@prisma/client";
import { db } from "./db";
import { getSettings } from "./settings";
import { distanceMeters, nearestGeofence } from "./geo";
import { formatHHMM, formatTime, minutesOfDay, parseHHMM, toDateKey } from "./dates";
import { getDayStatus } from "./calendar";
import { logAudit } from "./audit";
import { adminUserIds, notifyUsers } from "./notify";

// Geofenced punch in / punch out (PRD §4.2). The phone only reports what it
// sees; this module decides. Every real attempt is stored, accepted or not.

export const punchInputSchema = z.object({
  type: z.enum(["IN", "OUT"]),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000),
  deviceTime: z.number().int().positive(), // ms since epoch, from the phone clock
  deviceId: z.string().min(8).max(128),
  source: z.enum(["LIVE", "OFFLINE"]).default("LIVE"),
  mocked: z.boolean().optional(), // reported by a native wrapper; browsers cannot detect it
  dryRun: z.boolean().optional(), // status check only: nothing is stored
});
export type PunchInput = z.infer<typeof punchInputSchema>;

export type PunchResult = {
  accepted: boolean;
  dryRun: boolean;
  code: string;
  message: string;
  inside: boolean;
  distanceMeters: number | null;
  radiusMeters: number | null;
  geofenceName: string | null;
  flags: string[];
};

export function hashDeviceId(deviceId: string): string {
  return createHash("sha256").update(deviceId).digest("hex");
}

/** FR-10: close sessions from earlier days that never got a punch-out. */
export async function closeStaleSessions(beforeDateKey: string, studentId?: string): Promise<number> {
  const result = await db.campusSession.updateMany({
    where: { status: "OPEN", dateKey: { lt: beforeDateKey }, ...(studentId ? { studentId } : {}) },
    data: { status: "INCOMPLETE", closedReason: "No punch-out before the cut-off" },
  });
  return result.count;
}

/**
 * FR-10 scheduled job: sessions from earlier days, and today's sessions once
 * the punch cut-off has passed, are closed as INCOMPLETE.
 */
export async function autoCloseSessions(now = new Date()): Promise<number> {
  const settings = await getSettings();
  const today = toDateKey(now);
  let closed = await closeStaleSessions(today);
  if (minutesOfDay(now) > parseHHMM(settings.punchCutoff)) {
    const r = await db.campusSession.updateMany({
      where: { status: "OPEN", dateKey: today },
      data: { status: "INCOMPLETE", closedReason: `No punch-out before ${settings.punchCutoff}` },
    });
    closed += r.count;
  }
  return closed;
}

export async function processPunch(
  student: Pick<Student, "id" | "userId" | "departmentId" | "year">,
  input: PunchInput,
  userAgent: string | null,
): Promise<PunchResult> {
  const settings = await getSettings();
  const now = new Date();
  const dryRun = Boolean(input.dryRun);
  const flags: string[] = [];
  const deviceTime = new Date(input.deviceTime);
  const skewMs = settings.maxClockSkewMinutes * 60_000;
  const deviceHash = hashDeviceId(input.deviceId);

  // Offline punches keep the time they were made (FR-12); live ones use server time.
  let effectiveTime = now;
  if (input.source === "OFFLINE") {
    effectiveTime = deviceTime;
    if (now.getTime() - deviceTime.getTime() > settings.offlineSyncLimitHours * 3_600_000) flags.push("LATE_SYNC");
  } else if (Math.abs(deviceTime.getTime() - now.getTime()) > skewMs) {
    flags.push("CLOCK_SKEW"); // FR-9: device clock differs from server clock
  }
  const dateKey = toDateKey(effectiveTime);

  const fences = await db.geofence.findMany({ where: { isActive: true } });
  const near = nearestGeofence(fences, input);
  const allowed = near ? near.fence.radiusMeters + settings.toleranceMeters : 0;
  const inside = Boolean(near && near.distance <= allowed);
  const base = {
    dryRun,
    inside,
    distanceMeters: near ? Math.round(near.distance) : null,
    radiusMeters: near?.fence.radiusMeters ?? null,
    geofenceName: near?.fence.name ?? null,
    flags,
  };

  const record = async (status: PunchStatus, code: string, message: string, sessionId?: string) => {
    if (dryRun) return;
    await db.punchRecord.create({
      data: {
        studentId: student.id,
        type: input.type,
        status,
        reason: status === "REJECTED" ? code : null,
        message,
        latitude: input.latitude,
        longitude: input.longitude,
        accuracyMeters: input.accuracy,
        distanceMeters: base.distanceMeters,
        geofenceId: near?.fence.id ?? null,
        deviceHash,
        deviceTime,
        effectiveTime,
        source: input.source,
        flags: flags.length ? JSON.stringify(flags) : null,
        dateKey,
        sessionId,
      },
    });
  };
  const reject = async (code: string, message: string): Promise<PunchResult> => {
    await record("REJECTED", code, message);
    return { ...base, accepted: false, code, message };
  };

  // A queued offline punch re-sent after a lost response must not count twice.
  if (input.source === "OFFLINE" && !dryRun) {
    const dup = await db.punchRecord.findFirst({ where: { studentId: student.id, type: input.type, deviceTime, source: "OFFLINE" } });
    if (dup) return { ...base, accepted: dup.status === "ACCEPTED", code: "DUPLICATE", message: dup.message ?? "Already synced." };
  }

  if (input.mocked) {
    await logAudit({ actorId: student.userId, action: "PUNCH_MOCK_LOCATION", entityType: "Student", entityId: student.id });
    return reject("MOCK_LOCATION", "A fake-location app was detected. Turn it off to punch.");
  }
  if (input.source === "OFFLINE" && deviceTime.getTime() > now.getTime() + skewMs) {
    return reject("FUTURE_TIME", "This offline punch has a time in the future. Check your phone's clock.");
  }
  // FR-8: poor GPS fixes are refused rather than guessed at.
  if (input.accuracy > settings.maxAccuracyMeters) {
    return reject(
      "POOR_ACCURACY",
      `GPS accuracy is ${Math.round(input.accuracy)} m (needs ${settings.maxAccuracyMeters} m or better). Move to an open area and try again.`,
    );
  }
  if (!near) return reject("NO_GEOFENCE", "The campus location has not been set up yet. Please tell the college office.");

  // FR-4: device binding. The first phone is registered automatically.
  if (settings.requireDeviceBinding) {
    const device = await db.device.findUnique({ where: { userId_deviceHash: { userId: student.userId, deviceHash } } });
    if (device?.status === "PENDING") return reject("DEVICE_PENDING", "This phone is waiting for approval from the college office.");
    if (device?.status === "REJECTED" || device?.status === "REVOKED") {
      return reject("DEVICE_BLOCKED", "This phone is not allowed for punching. Use your registered phone or contact the office.");
    }
    if (!device) {
      const approved = await db.device.count({ where: { userId: student.userId, status: "APPROVED" } });
      if (approved > 0) {
        if (!dryRun) {
          await db.device.create({
            data: { userId: student.userId, deviceHash, userAgent: userAgent?.slice(0, 300), label: describeDevice(userAgent), status: "PENDING" },
          });
          await notifyUsers(await adminUserIds(), {
            title: "Device change request",
            body: "A student asked to punch from a new phone.",
            link: "/admin/devices",
          });
        }
        return reject(
          "DEVICE_NOT_REGISTERED",
          dryRun
            ? "This is not your registered phone. Punching from it will send an approval request to the office."
            : "This is not your registered phone. An approval request has been sent to the college office.",
        );
      }
      if (!dryRun) {
        await db.device.create({
          data: {
            userId: student.userId,
            deviceHash,
            userAgent: userAgent?.slice(0, 300),
            label: describeDevice(userAgent),
            status: "APPROVED",
            approvedAt: now,
          },
        });
        await logAudit({ actorId: student.userId, action: "DEVICE_BOUND", entityType: "Student", entityId: student.id });
        flags.push("NEW_DEVICE_BOUND");
      }
    } else if (!dryRun) {
      await db.device.update({ where: { id: device.id }, data: { lastSeenAt: now } });
    }
  }

  // FR-13: working days and college hours, unless the admin turned this off.
  if (settings.enforceSchedule) {
    const day = await getDayStatus(dateKey, { departmentId: student.departmentId, year: student.year });
    if (!day.working) return reject("NOT_WORKING_DAY", `Punching is closed today (${day.reason}).`);
    const opens = parseHHMM(settings.collegeStart) - settings.earlyArrivalMinutes;
    const closes = parseHHMM(settings.punchCutoff);
    const minute = minutesOfDay(effectiveTime);
    if (minute < opens || minute > closes) {
      return reject("OUTSIDE_HOURS", `Punching is open from ${formatHHMM(Math.max(0, opens))} to ${settings.punchCutoff}.`);
    }
  }

  // FR-5: inside the campus radius.
  if (!inside) {
    return reject(
      "OUTSIDE_GEOFENCE",
      `You are ${base.distanceMeters} m from ${near.fence.name}. You need to be within ${near.fence.radiusMeters} m to punch.`,
    );
  }

  // FR-9: impossible movement since the last accepted punch (flag, don't block).
  const last = await db.punchRecord.findFirst({
    where: { studentId: student.id, status: "ACCEPTED" },
    orderBy: { effectiveTime: "desc" },
  });
  if (last && effectiveTime > last.effectiveTime) {
    const metres = distanceMeters(last, input);
    const hours = (effectiveTime.getTime() - last.effectiveTime.getTime()) / 3_600_000;
    if (metres > 1000 && metres / 1000 / hours > settings.maxSpeedKmh) flags.push("IMPOSSIBLE_MOVEMENT");
  }

  // Session rules (§6): one open session; one session per day unless allowed.
  if (!dryRun) await closeStaleSessions(toDateKey(now), student.id);
  const open = await db.campusSession.findFirst({ where: { studentId: student.id, dateKey, status: "OPEN" } });
  if (input.type === "IN") {
    if (open) return reject("ALREADY_IN", `You already punched in at ${formatTime(open.inAt)}. Punch out when you leave.`);
    if (!settings.allowMultipleSessions) {
      const today = await db.campusSession.count({ where: { studentId: student.id, dateKey } });
      if (today > 0) return reject("ALREADY_DONE", "Today's campus attendance is already recorded.");
    }
  } else {
    if (!open) return reject("NOT_IN", "You have not punched in today.");
    if (effectiveTime < open.inAt) return reject("INVALID_TIME", "Punch-out time is before your punch-in time.");
  }

  if (dryRun) {
    return {
      ...base,
      accepted: true,
      code: "READY",
      message: `You are inside ${near.fence.name} (${base.distanceMeters} m from the centre). Ready to punch ${input.type === "IN" ? "in" : "out"}.`,
    };
  }

  let message: string;
  if (input.type === "IN") {
    const session = await db.campusSession.create({ data: { studentId: student.id, dateKey, inAt: effectiveTime } });
    message = `Punched in at ${formatTime(effectiveTime)}.`;
    await record("ACCEPTED", "OK", message, session.id);
  } else {
    const minutes = Math.round((effectiveTime.getTime() - open!.inAt.getTime()) / 60_000);
    await db.campusSession.update({
      where: { id: open!.id },
      data: { outAt: effectiveTime, status: "COMPLETE", minutesOnCampus: minutes },
    });
    message = `Punched out at ${formatTime(effectiveTime)}. Time on campus: ${Math.floor(minutes / 60)} h ${minutes % 60} min.`;
    await record("ACCEPTED", "OK", message, open!.id);
  }
  if (flags.some((f) => f !== "NEW_DEVICE_BOUND")) {
    await logAudit({ actorId: student.userId, action: "PUNCH_FLAGGED", entityType: "Student", entityId: student.id, details: { flags } });
  }
  return { ...base, accepted: true, code: "OK", message };
}

/** Short human label from a user agent, e.g. "Android · Chrome". */
export function describeDevice(ua: string | null): string {
  if (!ua) return "Unknown device";
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "macOS" : "Other";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${os} · ${browser}`;
}
