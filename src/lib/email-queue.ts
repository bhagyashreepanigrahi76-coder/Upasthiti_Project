import "server-only";
import type { EmailKind } from "@prisma/client";
import { db } from "./db";
import { deliverMail } from "./mailer";
import { adminUserIds, notifyUsers } from "./notify";

// Email queue with retries (FR-39, PRD §7 "a queue for email jobs so sends
// survive restarts"). Rows live in EmailLog; the tick job sends them.

const MAX_ATTEMPTS = 5;
const BATCH = 50;

export type QueuedEmail = {
  kind: EmailKind;
  to: string;
  subject: string;
  text: string;
  html?: string;
  priority?: number;
  runId?: string;
  studentId?: string;
  parentId?: string;
};

export async function enqueueEmails(emails: QueuedEmail[]): Promise<number> {
  if (emails.length === 0) return 0;
  const r = await db.emailLog.createMany({
    data: emails.map((e) => ({
      kind: e.kind,
      toAddress: e.to,
      subject: e.subject,
      textBody: e.text,
      htmlBody: e.html,
      priority: e.priority ?? 0,
      runId: e.runId,
      studentId: e.studentId,
      parentId: e.parentId,
    })),
  });
  return r.count;
}

/**
 * Sends due emails, highest priority first. Temporary failures are retried
 * with back-off (2, 4, 8, 16 minutes); permanent ones are marked BOUNCED and
 * the admins are told (FR-39 "alerts admin about bounces").
 */
export async function processEmailQueue(now = new Date()): Promise<{ sent: number; failed: number; bounced: number }> {
  const due = await db.emailLog.findMany({
    where: { status: "QUEUED", nextAttemptAt: { lte: now }, OR: [{ runId: null }, { run: { status: { not: "PAUSED" } } }] },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: BATCH,
  });
  let sent = 0;
  let failed = 0;
  let bounced = 0;
  for (const e of due) {
    // Claim the row so two workers never send the same email.
    const claimed = await db.emailLog.updateMany({ where: { id: e.id, status: "QUEUED" }, data: { status: "SENDING" } });
    if (claimed.count === 0) continue;
    const result = await deliverMail({ to: e.toAddress, subject: e.subject, text: e.textBody, html: e.htmlBody ?? undefined });
    const attempts = e.attempts + 1;
    if (result.ok) {
      await db.emailLog.update({ where: { id: e.id }, data: { status: "SENT", sentAt: new Date(), attempts, lastError: null } });
      sent++;
    } else if (result.permanent) {
      await db.emailLog.update({ where: { id: e.id }, data: { status: "BOUNCED", attempts, lastError: result.error } });
      bounced++;
    } else if (attempts >= MAX_ATTEMPTS) {
      await db.emailLog.update({ where: { id: e.id }, data: { status: "FAILED", attempts, lastError: result.error } });
      failed++;
    } else {
      await db.emailLog.update({
        where: { id: e.id },
        data: { status: "QUEUED", attempts, lastError: result.error, nextAttemptAt: new Date(Date.now() + 2 ** attempts * 60_000) },
      });
    }
  }
  if (bounced || failed) {
    await notifyUsers(await adminUserIds(), {
      title: `Email delivery problems: ${bounced} bounced, ${failed} failed`,
      body: "Check the addresses in Parent reports → Delivery log.",
      link: "/admin/reports?status=BOUNCED",
    });
  }
  return { sent, failed, bounced };
}

/** Queues a fresh copy of an email (FR-39 resend). */
export async function resendEmail(id: string): Promise<boolean> {
  const e = await db.emailLog.findUnique({ where: { id } });
  if (!e) return false;
  await db.emailLog.create({
    data: {
      kind: e.kind,
      toAddress: e.toAddress,
      subject: e.subject,
      textBody: e.textBody,
      htmlBody: e.htmlBody,
      priority: e.priority,
      runId: e.runId,
      studentId: e.studentId,
      parentId: e.parentId,
    },
  });
  return true;
}

/** Report runs with nothing left to send are marked complete. */
export async function completeFinishedRuns(): Promise<void> {
  const open = await db.reportRun.findMany({ where: { status: "SENDING" }, select: { id: true } });
  for (const run of open) {
    const left = await db.emailLog.count({ where: { runId: run.id, status: { in: ["QUEUED", "SENDING"] } } });
    if (left === 0) await db.reportRun.update({ where: { id: run.id }, data: { status: "COMPLETED" } });
  }
}
