import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { homePathForRoles } from "@/lib/roles";
import { APP_NAME, formatDateTime } from "@/lib/config";
import { Card, EmptyState, Skeleton } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { markAllRead, openNotification } from "./actions";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <p className="mb-4 text-sm font-semibold text-brand-700">{APP_NAME}</p>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <NotificationList />
      </Suspense>
    </div>
  );
}

async function NotificationList() {
  const user = await requireUser();
  const items = await db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 });
  const unread = items.filter((n) => !n.readAt).length;

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Notifications</h1>
        <Link href={homePathForRoles(user.roles)} className="text-sm text-brand-700 hover:underline">
          Back to my portal
        </Link>
      </div>
      <Card
        title={unread ? `${unread} unread` : "All read"}
        action={unread > 0 ? <ActionForm action={markAllRead} submitLabel="Mark all read" tone="secondary" className="flex items-center gap-2" /> : undefined}
      >
        {items.length === 0 ? (
          <EmptyState>No notifications yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((n) => (
              <li key={n.id}>
                <form action={openNotification}>
                  <input type="hidden" name="id" value={n.id} />
                  <button className="flex w-full items-start gap-3 py-3 text-left hover:bg-slate-50">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-brand-600"}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${n.readAt ? "text-slate-700" : "font-semibold text-slate-900"}`}>{n.title}</span>
                      {n.body && <span className="block text-sm text-slate-600">{n.body}</span>}
                      <span className="block text-xs text-slate-400">{formatDateTime(n.createdAt)}</span>
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
