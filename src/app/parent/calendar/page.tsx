import type { Metadata } from "next";
import Link from "next/link";
import { requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { EmptyState, PageHeader } from "@/components/ui";
import { CalendarView } from "@/components/calendar-view";

export const metadata: Metadata = { title: "Calendar" };

type Props = { searchParams: Promise<{ month?: string; child?: string }> };

export default async function ParentCalendarPage({ searchParams }: Props) {
  const user = await requirePortal("parent");
  const { month, child } = await searchParams;
  const parent = await db.parent.findUnique({
    where: { userId: user.id },
    include: { students: { include: { student: { include: { user: { select: { name: true } }, department: true } } } } },
  });
  const children = parent?.students.map((s) => s.student) ?? [];
  if (children.length === 0) {
    return (
      <>
        <PageHeader title="Academic calendar" />
        <EmptyState>No student is linked to your account yet.</EmptyState>
      </>
    );
  }
  // Only children linked to this parent can be selected.
  const selected = children.find((c) => c.id === child) ?? children[0];
  return (
    <>
      <PageHeader title="Academic calendar" subtitle={`${selected.user.name} · ${selected.department.code} Year ${selected.year}`}>
        {children.length > 1 && (
          <div className="flex gap-2 text-sm">
            {children.map((c) => (
              <Link
                key={c.id}
                href={`/parent/calendar?child=${c.id}`}
                className={`rounded-full px-3 py-1 ${c.id === selected.id ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700"}`}
              >
                {c.user.name.split(" ")[0]}
              </Link>
            ))}
          </div>
        )}
      </PageHeader>
      <CalendarView
        scope={{ departmentId: selected.departmentId, year: selected.year }}
        month={month}
        basePath={`/parent/calendar?child=${selected.id}`}
      />
    </>
  );
}
