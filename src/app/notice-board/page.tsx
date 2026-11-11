import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { CATEGORY_LABEL, publicNotices } from "@/lib/notices";
import { APP_NAME, COLLEGE_NAME, formatDateTime } from "@/lib/config";
import { Badge, EmptyState, Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Notice board" };

// FR-42: public notice board on the college web page. No sign-in needed.
export default function NoticeBoardPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-brand-700">{APP_NAME}</p>
          <p className="text-xs text-slate-500">{COLLEGE_NAME}</p>
        </div>
        <Link href="/login" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Sign in
        </Link>
      </header>
      <h1 className="mb-4 text-2xl font-semibold text-slate-900">Notice board</h1>
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Board />
      </Suspense>
      <p className="mt-6 text-xs text-slate-500">Students, parents and staff see more notices after signing in.</p>
    </div>
  );
}

async function Board() {
  await connection();
  const notices = await publicNotices(50);
  if (notices.length === 0) return <EmptyState>No public notices right now.</EmptyState>;
  return (
    <ul className="space-y-3">
      {notices.map((n) => (
        <li key={n.id} id={n.id} className={`rounded-xl border bg-white p-4 ${n.urgent ? "border-red-200" : "border-slate-200"}`}>
          <div className="flex flex-wrap gap-1.5">
            {n.urgent && <Badge tone="red">Urgent</Badge>}
            {n.pinned && <Badge tone="brand">Pinned</Badge>}
            <Badge>{CATEGORY_LABEL[n.category]}</Badge>
            {n.editedAt && <Badge tone="amber">Updated</Badge>}
          </div>
          <h2 className="mt-1 font-semibold text-slate-900">{n.title}</h2>
          <p className="text-xs text-slate-500">{formatDateTime(n.publishAt)}</p>
          <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{n.body}</p>
          {n.attachmentName && (
            <a href={`/api/notices/${n.id}/attachment`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-brand-700 hover:underline">
              📎 {n.attachmentName}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
