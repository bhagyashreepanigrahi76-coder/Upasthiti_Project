"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { type ActionState, success } from "@/lib/action-state";

export async function markAllRead(): Promise<ActionState> {
  const user = await requireUser();
  await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  refresh();
  return success("All caught up.");
}

/** Marks one notification read and opens its link. Only the owner can do this. */
export async function openNotification(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const n = await db.notification.findFirst({ where: { id, userId: user.id } });
  if (!n) redirect("/notifications");
  if (!n.readAt) await db.notification.update({ where: { id }, data: { readAt: new Date() } });
  // Only follow internal links.
  redirect(n.link && n.link.startsWith("/") && !n.link.startsWith("//") ? n.link : "/notifications");
}
