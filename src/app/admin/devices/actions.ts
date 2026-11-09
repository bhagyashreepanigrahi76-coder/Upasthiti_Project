"use server";

import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { notifyUsers } from "@/lib/notify";
import { type ActionState, failure, success } from "@/lib/action-state";

// FR-4: one approved device per student. Approving a new device revokes the old one.

export async function approveDevice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const deviceId = String(formData.get("id") ?? "");
  const device = await db.device.findUnique({ where: { id: deviceId } });
  if (!device) return failure("Device not found.");
  await db.$transaction([
    db.device.updateMany({
      where: { userId: device.userId, status: "APPROVED", id: { not: device.id } },
      data: { status: "REVOKED" },
    }),
    db.device.update({
      where: { id: device.id },
      data: { status: "APPROVED", approvedById: admin.id, approvedAt: new Date() },
    }),
  ]);
  await notifyUsers([device.userId], {
    title: "New phone approved",
    body: "You can now punch in and out from your new device.",
    link: "/student/punch",
  });
  await logAudit({ actorId: admin.id, action: "DEVICE_APPROVED", entityType: "Device", entityId: device.id, details: { userId: device.userId } });
  refresh();
  return success("Device approved. Any previous device was revoked.");
}

export async function rejectDevice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const deviceId = String(formData.get("id") ?? "");
  const device = await db.device.findUnique({ where: { id: deviceId } });
  if (!device) return failure("Device not found.");
  const status = device.status === "APPROVED" ? "REVOKED" : "REJECTED";
  await db.device.update({ where: { id: device.id }, data: { status } });
  await logAudit({ actorId: admin.id, action: status === "REVOKED" ? "DEVICE_REVOKED" : "DEVICE_REJECTED", entityType: "Device", entityId: device.id, details: { userId: device.userId } });
  refresh();
  return success(status === "REVOKED" ? "Device revoked." : "Request rejected.");
}
