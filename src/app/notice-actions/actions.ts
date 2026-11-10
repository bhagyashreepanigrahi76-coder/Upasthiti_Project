"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getSettings, saveSettings } from "@/lib/settings";
import { addDays, isDateKey, zonedDateTime } from "@/lib/dates";
import { saveUpload, type StoredFile } from "@/lib/uploads";
import { adminUserIds, notifyUsers } from "@/lib/notify";
import { audienceContext, canSee, deliverNotice, postRights } from "@/lib/notices";
import { type ActionState, failure, formValues, fromZodError, success } from "@/lib/action-state";

const noticeSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(3, "Enter a title").max(150),
  body: z.string().trim().min(1, "Write the message").max(5000),
  category: z.enum(["EXAM", "RESULT", "HOLIDAY", "EVENT", "TIMETABLE", "PLACEMENT", "GENERAL"]),
  audience: z.enum(["EVERYONE", "STUDENTS", "TEACHERS", "PARENTS"]),
  departmentId: z.string().optional(),
  year: z.coerce.number().int().min(1).max(3).optional(),
  sectionId: z.string().optional(),
  subjectId: z.string().optional(),
  publishDate: z.string().refine(isDateKey, "Enter a valid date").optional(),
  publishTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").optional(),
  expiresOn: z.string().refine(isDateKey, "Enter a valid date").optional(),
  calendarEventId: z.string().optional(),
});

const snapshot = (n: object) => JSON.stringify(n);

/** Create or edit a notice (FR-43..50). */
export async function saveNotice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const rights = await postRights(user);
  if (!rights) return failure("You don't have permission to post notices.");
  const parsed = noticeSchema.safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const v = parsed.data;
  const flag = (k: string) => formData.get(k) === "on";
  const settings = await getSettings();

  // Narrow the audience to what this poster may target.
  let { departmentId, year } = v;
  const { sectionId, subjectId } = v;
  if (sectionId) {
    const section = await db.section.findUnique({ where: { id: sectionId } });
    if (!section) return failure("Section not found.");
    departmentId = section.departmentId;
    year = section.year;
  }
  if (rights.level === "hod") {
    if (!departmentId) departmentId = rights.departments[0];
    if (!rights.departments.includes(departmentId)) return failure("HODs can post only for their own department.");
  }
  if (rights.level === "teacher") {
    if (v.audience !== "STUDENTS" && v.audience !== "PARENTS") return failure("Teachers can post to their students or their parents only.");
    const ok = (sectionId && rights.sectionIds.includes(sectionId)) || (subjectId && rights.subjectIds.includes(subjectId));
    if (!ok) return { error: "Choose one of your sections or subjects.", fieldErrors: { sectionId: "Pick a class you teach" } };
  }
  const isPublic = flag("isPublic");
  if (isPublic && (rights.level !== "admin" || v.audience !== "EVERYONE" || departmentId || year || sectionId || subjectId)) {
    return failure("Only college-wide notices for everyone, posted by the admin, can go on the public board.");
  }

  const now = new Date();
  const publishAt = v.publishDate ? zonedDateTime(v.publishDate, v.publishTime ?? "00:00") : now;
  const expiresAt = v.expiresOn ? zonedDateTime(addDays(v.expiresOn, 1), "00:00") : null;
  if (expiresAt && expiresAt <= publishAt) return { error: "The expiry date must be after the publish date.", fieldErrors: { expiresOn: "After the publish date" } };

  let attachment: StoredFile | null = null;
  const file = formData.get("attachment");
  if (file instanceof File && file.size > 0) {
    try {
      attachment = await saveUpload(file, "notices", settings.uploadMaxMb, { allowWord: true });
    } catch (err) {
      return { error: (err as Error).message, fieldErrors: { attachment: (err as Error).message } };
    }
  }

  const needsApproval = rights.level !== "admin" && settings.noticeApprovalRequired;
  const data = {
    title: v.title,
    body: v.body,
    category: v.category,
    audience: v.audience,
    departmentId: departmentId ?? null,
    year: year ?? null,
    sectionId: sectionId ?? null,
    subjectId: subjectId ?? null,
    urgent: flag("urgent"),
    pinned: rights.level === "teacher" ? false : flag("pinned"),
    isPublic,
    publishAt,
    expiresAt,
    notifyOnPublish: flag("notifyOnPublish"),
    emailOnPublish: flag("emailOnPublish"),
    calendarEventId: v.calendarEventId ?? null,
    ...(attachment
      ? { attachmentPath: attachment.path, attachmentName: attachment.name, attachmentMime: attachment.mime, attachmentSize: attachment.size }
      : flag("removeAttachment")
        ? { attachmentPath: null, attachmentName: null, attachmentMime: null, attachmentSize: null }
        : {}),
  };

  let noticeId: string;
  if (v.id) {
    const existing = await db.notice.findUnique({ where: { id: v.id } });
    if (!existing || (existing.createdById !== user.id && rights.level !== "admin")) return failure("You can edit only your own notices.");
    if (existing.status === "WITHDRAWN") return failure("A withdrawn notice cannot be edited.");
    const wasLive = existing.status === "PUBLISHED" && existing.publishAt <= now;
    await db.notice.update({
      where: { id: existing.id },
      data: { ...data, status: needsApproval ? "PENDING_APPROVAL" : existing.status === "REJECTED" ? "PUBLISHED" : existing.status, editedAt: wasLive ? now : existing.editedAt },
    });
    await db.noticeHistory.create({ data: { noticeId: existing.id, action: "EDITED", actorId: user.id, snapshot: snapshot(existing) } });
    noticeId = existing.id;
  } else {
    const created = await db.notice.create({ data: { ...data, status: needsApproval ? "PENDING_APPROVAL" : "PUBLISHED", createdById: user.id } });
    await db.noticeHistory.create({ data: { noticeId: created.id, action: "CREATED", actorId: user.id } });
    noticeId = created.id;
  }

  const saved = await db.notice.findUniqueOrThrow({ where: { id: noticeId } });
  if (saved.status === "PENDING_APPROVAL") {
    await notifyUsers(await adminUserIds(), { title: `Notice waiting for approval: ${saved.title}`, body: `From ${user.name}`, link: "/admin/notices" });
  } else if (saved.publishAt <= now && saved.notifyOnPublish) {
    await deliverNotice(saved.id);
  }
  await logAudit({ actorId: user.id, action: v.id ? "NOTICE_EDITED" : "NOTICE_CREATED", entityType: "Notice", entityId: noticeId, details: { title: v.title, status: saved.status } });
  refresh();
  if (saved.status === "PENDING_APPROVAL") return success("Saved. The notice will appear once the admin approves it.");
  return success(saved.publishAt > now ? "Notice scheduled." : v.id ? "Notice updated." : "Notice published.");
}

export async function withdrawNotice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const n = await db.notice.findUnique({ where: { id } });
  if (!n || (n.createdById !== user.id && !user.roles.includes("ADMIN"))) return failure("You can withdraw only your own notices.");
  await db.notice.update({ where: { id }, data: { status: "WITHDRAWN" } });
  await db.noticeHistory.create({ data: { noticeId: id, action: "WITHDRAWN", actorId: user.id, snapshot: snapshot(n) } });
  await logAudit({ actorId: user.id, action: "NOTICE_WITHDRAWN", entityType: "Notice", entityId: id });
  refresh();
  return success("Notice withdrawn. It stays in the history but is no longer shown.");
}

/** Admin approval for HOD and teacher notices (FR-50). */
export async function decideNotice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!user.roles.includes("ADMIN")) return failure("Admin only.");
  const id = String(formData.get("id") ?? "");
  const decision = formData.get("decision") === "APPROVED" ? "APPROVED" : "REJECTED";
  const n = await db.notice.findUnique({ where: { id } });
  if (!n || n.status !== "PENDING_APPROVAL") return failure("This notice is not waiting for approval.");
  await db.notice.update({
    where: { id },
    data: decision === "APPROVED" ? { status: "PUBLISHED", approvedById: user.id, approvedAt: new Date() } : { status: "REJECTED" },
  });
  await db.noticeHistory.create({ data: { noticeId: id, action: decision, actorId: user.id } });
  await notifyUsers([n.createdById], { title: `Notice ${decision === "APPROVED" ? "approved" : "not approved"}: ${n.title}`, link: "/notices" });
  if (decision === "APPROVED" && n.publishAt <= new Date() && n.notifyOnPublish) await deliverNotice(id);
  await logAudit({ actorId: user.id, action: `NOTICE_${decision}`, entityType: "Notice", entityId: id });
  refresh();
  return success(decision === "APPROVED" ? "Notice approved and published." : "Notice rejected.");
}

/** FR-52 read tracking: called when a notice is actually opened. */
export async function markNoticeRead(noticeId: string): Promise<void> {
  const user = await requireUser();
  const n = await db.notice.findUnique({ where: { id: noticeId } });
  if (!n || n.status !== "PUBLISHED" || !canSee(n, await audienceContext(user))) return;
  await db.noticeRead.upsert({ where: { noticeId_userId: { noticeId, userId: user.id } }, create: { noticeId, userId: user.id }, update: {} });
}

export async function saveNoticeSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!user.roles.includes("ADMIN")) return failure("Admin only.");
  const values = { teachersCanPostNotices: formData.get("teachersCanPostNotices") === "on", noticeApprovalRequired: formData.get("noticeApprovalRequired") === "on" };
  await saveSettings(values);
  await logAudit({ actorId: user.id, action: "SETTINGS_UPDATED", details: values });
  refresh();
  return success("Notice settings saved.");
}
