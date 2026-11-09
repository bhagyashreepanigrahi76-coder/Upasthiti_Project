import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { SectionEditor } from "@/components/timetable-manager";

export const metadata: Metadata = { title: "Edit timetable" };

type Props = { params: Promise<{ sectionId: string }>; searchParams: Promise<{ date?: string }> };

export default async function HodSectionTimetablePage({ params, searchParams }: Props) {
  const user = await requireRole("HOD");
  const [{ sectionId }, { date }] = await Promise.all([params, searchParams]);
  // SectionEditor returns 404 for sections outside the HOD's departments.
  return <SectionEditor user={user} sectionId={sectionId} basePath="/hod/timetable" date={date} />;
}
