import type { Metadata } from "next";
import Link from "next/link";
import { requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { EmptyState, PageHeader } from "@/components/ui";
import { ResultsView } from "@/components/results-view";

export const metadata: Metadata = { title: "Results" };

type Props = { searchParams: Promise<{ child?: string }> };

export default async function ParentResultsPage({ searchParams }: Props) {
  const user = await requirePortal("parent");
  const { child } = await searchParams;
  const parent = await db.parent.findUnique({
    where: { userId: user.id },
    include: { students: { include: { student: { include: { user: { select: { name: true } } } } } } },
  });
  const children = parent?.students.map((s) => s.student) ?? [];
  if (children.length === 0) {
    return (
      <>
        <PageHeader title="Results" />
        <EmptyState>No student is linked to your account yet.</EmptyState>
      </>
    );
  }
  const selected = children.find((c) => c.id === child) ?? children[0];
  return (
    <>
      <PageHeader
        title={`Results · ${selected.user.name}`}
        subtitle={<Link href={`/report-card/${selected.id}`} className="text-brand-700 hover:underline">Report card</Link>}
      >
        {children.length > 1 && (
          <div className="flex gap-2 text-sm">
            {children.map((c) => (
              <Link key={c.id} href={`/parent/results?child=${c.id}`} className={`rounded-full px-3 py-1 ${c.id === selected.id ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700"}`}>
                {c.user.name.split(" ")[0]}
              </Link>
            ))}
          </div>
        )}
      </PageHeader>
      <ResultsView studentId={selected.id} />
    </>
  );
}
