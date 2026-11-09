"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Tabs for pages that share a section, e.g. Academic setup. */
export function SubNav({ items }: { items: { label: string; href: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="Section navigation">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
              active ? "border-brand-600 text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
