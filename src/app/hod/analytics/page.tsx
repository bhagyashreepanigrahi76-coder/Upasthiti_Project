import type { Metadata } from "next";
import { departmentsFor, requirePortal } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { AnalyticsView } from "@/components/analytics-view";

export const metadata: Metadata = { title: "Department analytics" };

export default async function HodAnalyticsPage() {
  const user = await requirePortal("hod");
  return (
    <>
      <PageHeader title="Department analytics" subtitle="Your department only (PRD §3)." />
      <AnalyticsView departmentIds={departmentsFor(user, "HOD")} />
    </>
  );
}
