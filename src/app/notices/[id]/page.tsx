import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { CATEGORY_LABEL, audienceContext, canSee, readStats } from "@/lib/notices";
import { formatDateKey } from "@/lib/dates";
import { APP_NAME, formatDateTime } from "@/lib/config";
import { Badge, Card, Skeleton } from "@/components/ui";
import { MarkRead } from "./mark-read";

export const metadata: Metadata = { title: "Notice" };

type Props = { params: Promise<{ id: string }> };

export default function NoticePage({ params }: Props) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <p className="mb-4 text-sm font-semibold text-brand-700">{APP_NAME}</p>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <NoticeDetail params={params} />
      </Suspense>
    </div>
  );
}

async function NoticeDetail({ params }: Props) {
  const user = await requireUser();
  const { id } = await params;
  const n = await db.notice.findUnique({
    where: { id },
    include: { createdBy: { select: { name: true } }, calendarEvent: true, section: true, department: true, subject: true },
  });
  const now = new Date();
  const isOwnerOrAdmin = n && (n.createdById === user.id || user.roles.includes("ADMIN"));
  const live = n && n.status === "PUBLISHED" && n.publishAt <= now;
  if (!n || !(isOwnerOrAdmin || (live && canSee(n, await audienceContext(user))))) notFound();
  const stats = isOwnerOrAdmin && n.urgent ? await readStats(n) : null;
  const expired = n.expiresAt && n.expiresAt <= now;

  return (
    <>
      {live && <MarkRead noticeId={n.id} />}
      <Link href="/notices" className="text-sm text-brand-700 hover:underline">
        ← All notices
      </Link>
      <Card className={`mt-3 ${n.urgent ? "border-red-200" : ""}`}>
        <div className="flex flex-wrap gap-1.5">
          {n.urgent && <Badge tone="red">Urgent</Badge>}
          {n.pinned && <Badge tone="brand">Pinned</Badge>}
          <Badge>{CATEGORY_LABEL[n.category]}</Badge>
          {n.editedAt && <Badge tone="amber">Updated {formatDateTime(n.editedAt)}</Badge>}
          {expired && <Badge>Archived</Badge>}
          {n.status !== "PUBLISHED" && <Badge tone="amber">{n.status.replace("_", " ").toLowerCase()}</Badge>}
          {n.status === "PUBLISHED" && n.publishAt > now && <Badge tone="amber">Scheduled for {formatDateTime(n.publishAt)}</Badge>}
        </div>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">{n.title}</h1>
        <p className="text-xs text-slate-500">
          {formatDateTime(n.publishAt)} · {n.createdBy.name}
          {n.expiresAt && ` · until ${formatDateTime(n.expiresAt)}`}
        </p>
        <div className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-800">{n.body}</div>

        {n.calendarEvent && (
          <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm">
            Calendar: <strong>{n.calendarEvent.title}</strong>,{" "}
            {n.calendarEvent.startDate === n.calendarEvent.endDate
              ? formatDateKey(n.calendarEvent.startDate)
              : `${formatDateKey(n.calendarEvent.startDate)} – ${formatDateKey(n.calendarEvent.endDate)}`}
          </p>
        )}
        {n.attachmentName && (
          <p className="mt-4">
            <a href={`/api/notices/${n.id}/attachment`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              📎 {n.attachmentName}
            </a>
          </p>
        )}
        {stats && (
          <p className="mt-4 text-xs text-slate-500">
            Opened by {stats.read} of {stats.audience} people in the audience.
          </p>
        )}
      </Card>
    </>
  );
}
