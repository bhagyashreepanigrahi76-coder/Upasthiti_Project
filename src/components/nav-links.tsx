"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/nav";

type Props = { items: NavItem[]; layout: "sidebar" | "bar" };

/**
 * Portal navigation. The active-link highlight needs the URL, which on pages
 * with dynamic segments is only known at request time, so it streams in
 * behind Suspense; the fallback is the same list without highlighting.
 */
export function NavLinks(props: Props) {
  return (
    <Suspense fallback={<NavList {...props} pathname={null} />}>
      <ActiveNavList {...props} />
    </Suspense>
  );
}

function ActiveNavList(props: Props) {
  return <NavList {...props} pathname={usePathname()} />;
}

function NavList({ items, layout, pathname }: Props & { pathname: string | null }) {
  const sidebar = layout === "sidebar";

  return (
    <ul className={sidebar ? "space-y-0.5" : "flex gap-1 overflow-x-auto pb-1"}>
      {items.map((item) => {
        if (!item.href) {
          return (
            <li key={item.label} className={sidebar ? "" : "shrink-0"}>
              <span
                className="flex cursor-not-allowed items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-slate-400"
                title={`Planned for Day ${item.day}`}
              >
                {item.label}
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                  Day {item.day}
                </span>
              </span>
            </li>
          );
        }
        // Section roots (e.g. /admin) match exactly; other links also match their sub-pages.
        const isRoot = item.href.split("/").length === 2;
        const active = pathname !== null && (pathname === item.href || (!isRoot && pathname.startsWith(item.href + "/")));
        return (
          <li key={item.label} className={sidebar ? "" : "shrink-0"}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`block rounded-md px-3 py-2 text-sm font-medium ${
                active ? "bg-brand-50 text-brand-700" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
