import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { SectionEditor } from "@/components/timetable-manager";

export const metadata: Metadata = { title: "Edit timetable" };

type Props = { params: Promise<{ sectionId: string }>; searchParams: Promise<{ date?: string }> };

export default async function AdminSectionTimetablePage({ params, searchParams }: Props) {
  const user = await requireRole("ADMIN");
  const [{ sectionId }, { date }] = await Promise.all([params, searchParams]);
  return <SectionEditor user={user} sectionId={sectionId} basePath="/admin/timetable" date={date} />;
}
