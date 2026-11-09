import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { SectionList } from "@/components/timetable-manager";

export const metadata: Metadata = { title: "Timetables" };

export default async function AdminTimetablePage() {
  const user = await requireRole("ADMIN");
  return (
    <>
      <PageHeader title="Timetables" subtitle="One weekly timetable per section, versioned by the date it takes effect.">
        <Link href="/admin/timetable/setup" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Period timings & rooms
        </Link>
      </PageHeader>
      <SectionList user={user} basePath="/admin/timetable" />
    </>
  );
}
