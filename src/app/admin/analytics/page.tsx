import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { AnalyticsView } from "@/components/analytics-view";

export const metadata: Metadata = { title: "Attendance analytics" };

export default async function AdminAnalyticsPage() {
  await requireRole("ADMIN");
  return (
    <>
      <PageHeader title="Attendance analytics" subtitle="Whole college: day-wise attendance, defaulters, department comparison and punch exceptions (FR-29)." />
      <AnalyticsView departmentIds={null} mentorLinkBase="/admin/users" />
    </>
  );
}
