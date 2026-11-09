import { Suspense } from "react";
import Link from "next/link";
import { NAV } from "@/lib/nav";
import { PORTALS, type PortalKey } from "@/lib/roles";
import { APP_NAME, COLLEGE_NAME } from "@/lib/config";
import { NavLinks } from "./nav-links";
import { UserMenu, UserMenuSkeleton } from "./user-menu";

// Static frame for a portal. Everything here prerenders except the user menu,
// which reads the session and streams in behind its own Suspense boundary.
export function PortalShell({ portal, children }: { portal: PortalKey; children: React.ReactNode }) {
  const items = NAV[portal];
  const info = PORTALS[portal];

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white md:block">
        <div className="sticky top-0 flex max-h-screen flex-col overflow-y-auto p-4">
          <Link href={info.path} className="mb-6 block px-3">
            <span className="block text-sm font-semibold text-brand-700">{APP_NAME}</span>
            <span className="block text-xs text-slate-500">{info.label} portal</span>
          </Link>
          <nav aria-label={`${info.label} navigation`}>
            <NavLinks items={items} layout="sidebar" />
          </nav>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{COLLEGE_NAME}</p>
              <p className="text-xs text-slate-500 md:hidden">{info.label} portal</p>
            </div>
            <Suspense fallback={<UserMenuSkeleton />}>
              <UserMenu current={portal} />
            </Suspense>
          </div>
          <nav aria-label={`${info.label} navigation`} className="mt-3 md:hidden">
            <NavLinks items={items} layout="bar" />
          </nav>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
