import type { Metadata } from "next";
import Link from "next/link";
import { requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { EmptyState, PageHeader } from "@/components/ui";
import { AttendanceReport } from "@/components/attendance-report";

export const metadata: Metadata = { title: "Attendance" };

type Props = { searchParams: Promise<{ child?: string; month?: string }> };

export default async function ParentAttendancePage({ searchParams }: Props) {
  const user = await requirePortal("parent");
  const { child, month } = await searchParams;
  const parent = await db.parent.findUnique({
    where: { userId: user.id },
    include: { students: { include: { student: { include: { user: { select: { name: true } } } } } } },
  });
  const children = parent?.students.map((s) => s.student) ?? [];
  if (children.length === 0) {
    return (
      <>
        <PageHeader title="Attendance" />
        <EmptyState>No student is linked to your account yet.</EmptyState>
      </>
    );
  }
  // Only this parent's own children can be selected.
  const selected = children.find((c) => c.id === child) ?? children[0];
  return (
    <>
      <PageHeader title={`Attendance · ${selected.user.name}`} subtitle={selected.rollNo}>
        {children.length > 1 && (
          <div className="flex gap-2 text-sm">
            {children.map((c) => (
              <Link key={c.id} href={`/parent/attendance?child=${c.id}`} className={`rounded-full px-3 py-1 ${c.id === selected.id ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700"}`}>
                {c.user.name.split(" ")[0]}
              </Link>
            ))}
          </div>
        )}
      </PageHeader>
      <AttendanceReport studentId={selected.id} month={month} basePath={`/parent/attendance?child=${selected.id}`} />
    </>
  );
}
