import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { SectionList } from "@/components/timetable-manager";

export const metadata: Metadata = { title: "Timetables" };

export default async function HodTimetablePage() {
  const user = await requireRole("HOD");
  return (
    <>
      <PageHeader title="Department timetables" subtitle="You can edit timetables for sections in your department." />
      <SectionList user={user} basePath="/hod/timetable" />
    </>
  );
}
