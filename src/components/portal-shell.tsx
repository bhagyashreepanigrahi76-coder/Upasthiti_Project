import { Suspense } from "react";
import Link from "next/link";
import { NAV } from "@/lib/nav";
import { PORTALS, type PortalKey } from "@/lib/roles";
import { APP_NAME, COLLEGE_NAME } from "@/lib/config";
import { NavLinks } from "./nav-links";
import { UserMenu, UserMenuSkeleton } from "./user-menu";
import { CollegeMark } from "./college-mark";

// Static frame for a portal, in the Sambalpuri theme: an ikat band across
// the top, a maroon sidebar header with the chakra emblem. Everything here
// prerenders except the user menu, which streams in behind Suspense.
export function PortalShell({ portal, children }: { portal: PortalKey; children: React.ReactNode }) {
  const items = NAV[portal];
  const info = PORTALS[portal];

  return (
    <div className="flex min-h-screen flex-col">
      <div className="sambalpuri-band h-3 print:hidden" aria-hidden="true" />
      <div className="flex flex-1">
        <aside className="hidden w-64 shrink-0 border-r border-brand-100 bg-white md:block print:hidden">
          <div className="sticky top-0 flex max-h-screen flex-col overflow-y-auto">
            <Link href={info.path} className="flex items-center gap-3 bg-brand-700 px-4 py-4 text-white">
              <CollegeMark size={38} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{APP_NAME}</span>
                <span className="block text-xs text-haldi-100">{info.label} portal</span>
              </span>
            </Link>
            <div className="temple-border h-2" aria-hidden="true" />
            <nav aria-label={`${info.label} navigation`} className="p-3">
              <NavLinks items={items} layout="sidebar" />
            </nav>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-brand-100 bg-white px-4 py-3 sm:px-6 print:hidden">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <CollegeMark size={28} className="md:hidden" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-brand-900">
                    <span className="md:hidden">{APP_NAME} · </span>
                    {COLLEGE_NAME}
                  </p>
                  <p className="text-xs text-slate-500 md:hidden">{info.label} portal</p>
                </div>
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

          <footer className="border-t border-brand-100 bg-white px-4 py-3 text-xs text-slate-500 sm:px-6 print:hidden">
            {COLLEGE_NAME} ·{" "}
            <Link href="/notice-board" className="hover:text-brand-700 hover:underline">
              Notice board
            </Link>{" "}
            ·{" "}
            <Link href="/privacy" className="hover:text-brand-700 hover:underline">
              Privacy
            </Link>
          </footer>
        </div>
      </div>
    </div>
  );
}
