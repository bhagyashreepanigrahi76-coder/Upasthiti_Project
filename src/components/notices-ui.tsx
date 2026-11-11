import Link from "next/link";
import { connection } from "next/server";
import type { CurrentUser } from "@/lib/auth";
import { CATEGORY_LABEL, publicNotices, visibleNotices } from "@/lib/notices";
import { formatDateTime } from "@/lib/config";
import { Badge, Card, EmptyState } from "./ui";

// Notice board building blocks (FR-42, FR-45, FR-49).

type ListNotice = {
  id: string;
  title: string;
  category: keyof typeof CATEGORY_LABEL;
  urgent: boolean;
  pinned: boolean;
  publishAt: Date;
  editedAt: Date | null;
  attachmentName: string | null;
  createdBy: { name: string };
  reads?: { readAt: Date }[];
};

export function NoticeItem({ n, href, showUnread = true }: { n: ListNotice; href: string; showUnread?: boolean }) {
  const unread = showUnread && n.reads !== undefined && n.reads.length === 0;
  return (
    <li className={`rounded-lg border p-3 ${n.urgent ? "border-red-200 bg-red-50/60" : "border-slate-200 bg-white"}`}>
      <Link href={href} className="block">
        <div className="flex flex-wrap items-center gap-1.5">
          {unread && <span className="h-2 w-2 rounded-full bg-brand-600" aria-label="Unread" />}
          {n.urgent && <Badge tone="red">Urgent</Badge>}
          {n.pinned && <Badge tone="brand">Pinned</Badge>}
          <Badge>{CATEGORY_LABEL[n.category]}</Badge>
          {n.editedAt && <Badge tone="amber">Updated</Badge>}
        </div>
        <p className={`mt-1 text-sm ${unread ? "font-semibold" : "font-medium"} text-slate-900`}>{n.title}</p>
        <p className="text-xs text-slate-500">
          {formatDateTime(n.publishAt)} · {n.createdBy.name}
          {n.attachmentName && " · 📎 attachment"}
        </p>
      </Link>
    </li>
  );
}

/** Latest notices for a signed-in user, with a red banner for unread urgent ones. */
export async function DashboardNotices({ user }: { user: CurrentUser }) {
  const notices = await visibleNotices(user, { limit: 5 });
  const urgentUnread = notices.filter((n) => n.urgent && n.reads.length === 0);
  return (
    <>
      {urgentUnread.map((n) => (
        <Link key={n.id} href={`/notices/${n.id}`} className="mb-4 block rounded-lg bg-red-600 px-4 py-3 text-sm text-white hover:bg-red-700">
          <span className="font-semibold">Urgent:</span> {n.title} <span className="underline">Read now</span>
        </Link>
      ))}
      <Card
        title="Latest announcements"
        action={
          <Link href="/notices" className="text-xs font-medium text-brand-700 hover:underline">
            All notices
          </Link>
        }
      >
        {notices.length === 0 ? (
          <EmptyState>No announcements.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {notices.map((n) => (
              <NoticeItem key={n.id} n={n} href={`/notices/${n.id}`} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

/** Public "Latest announcements" strip for the login and home pages (FR-42). */
export async function PublicNoticeStrip({ limit = 3 }: { limit?: number }) {
  await connection(); // read at request time so scheduled notices appear on time
  const notices = await publicNotices(limit);
  if (notices.length === 0) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">Latest announcements</p>
        <Link href="/notice-board" className="text-xs font-medium text-brand-700 hover:underline">
          Notice board
        </Link>
      </div>
      <ul className="space-y-1.5">
        {notices.map((n) => (
          <li key={n.id} className="text-sm">
            <Link href={`/notice-board#${n.id}`} className="text-slate-800 hover:underline">
              {n.urgent && <span className="mr-1 font-semibold text-red-700">Urgent:</span>}
              {n.title}
            </Link>
            <span className="ml-2 text-xs text-slate-500">{CATEGORY_LABEL[n.category]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
