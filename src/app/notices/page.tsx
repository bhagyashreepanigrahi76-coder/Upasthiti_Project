import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import type { NoticeCategory } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { CATEGORY_LABEL, visibleNotices } from "@/lib/notices";
import { homePathForRoles } from "@/lib/roles";
import { addDays, isDateKey, zonedDateTime } from "@/lib/dates";
import { APP_NAME } from "@/lib/config";
import { EmptyState, Skeleton } from "@/components/ui";
import { inputClass } from "@/components/form-fields";
import { NoticeItem } from "@/components/notices-ui";

export const metadata: Metadata = { title: "Notices" };

type SP = Promise<Record<string, string | undefined>>;

export default function NoticesPage({ searchParams }: { searchParams: SP }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <p className="mb-4 text-sm font-semibold text-brand-700">{APP_NAME}</p>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <NoticeList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function NoticeList({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sp = await searchParams;
  const archive = sp.view === "archive";
  const category = sp.category && sp.category in CATEGORY_LABEL ? (sp.category as NoticeCategory) : undefined;
  const notices = await visibleNotices(user, {
    archive,
    q: sp.q?.trim() || undefined,
    category,
    from: isDateKey(sp.from) ? zonedDateTime(sp.from, "00:00") : undefined,
    to: isDateKey(sp.to) ? zonedDateTime(addDays(sp.to, 1), "00:00") : undefined,
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">{archive ? "Notice archive" : "Notices"}</h1>
        <div className="flex gap-3 text-sm">
          <Link href={archive ? "/notices" : "/notices?view=archive"} className="text-brand-700 hover:underline">
            {archive ? "Current notices" : "Archive"}
          </Link>
          <Link href={homePathForRoles(user.roles)} className="text-brand-700 hover:underline">
            Back to my portal
          </Link>
        </div>
      </div>

      {/* FR-51: search by keyword, category or date */}
      <form method="get" className="mb-5 grid gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-5">
        {archive && <input type="hidden" name="view" value="archive" />}
        <input name="q" defaultValue={sp.q} placeholder="Search notices" className={`${inputClass} lg:col-span-2`} aria-label="Search" />
        <select name="category" defaultValue={category ?? ""} className={inputClass} aria-label="Category">
          <option value="">All categories</option>
          {Object.entries(CATEGORY_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <input name="from" type="date" defaultValue={sp.from} className={inputClass} aria-label="From date" />
        <div className="flex gap-2">
          <input name="to" type="date" defaultValue={sp.to} className={inputClass} aria-label="To date" />
          <button className="rounded-md bg-slate-800 px-3 text-sm font-medium text-white">Go</button>
        </div>
      </form>

      {notices.length === 0 ? (
        <EmptyState>{archive ? "No archived notices match." : "No notices match."}</EmptyState>
      ) : (
        <ul className="space-y-2">
          {notices.map((n) => (
            <NoticeItem key={n.id} n={n} href={`/notices/${n.id}`} />
          ))}
        </ul>
      )}
    </>
  );
}
