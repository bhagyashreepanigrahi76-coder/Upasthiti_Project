import type { Metadata } from "next";
import { departmentsFor, requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { AssessmentList, assessmentListInclude } from "@/components/assessment-list";

export const metadata: Metadata = { title: "Marks verification" };

export default async function HodMarksPage() {
  const user = await requirePortal("hod");
  const scope = { section: { departmentId: { in: departmentsFor(user, "HOD") } } };
  const [toVerify, later] = await Promise.all([
    db.assessment.findMany({ where: { status: "SUBMITTED", ...scope }, include: assessmentListInclude, orderBy: { submittedAt: "asc" } }),
    db.assessment.findMany({
      where: { status: { in: ["VERIFIED", "LOCKED", "PUBLISHED"] }, ...scope },
      include: assessmentListInclude,
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
  ]);
  return (
    <>
      <PageHeader title="Marks verification" subtitle="Check submitted marks before the admin locks and publishes them (FR-23)." />
      <Card title={`Waiting for verification (${toVerify.length})`}>
        <AssessmentList rows={toVerify} basePath="/hod/marks" empty="Nothing to verify." />
      </Card>
      <Card title="Verified, locked and published" className="mt-6">
        <AssessmentList rows={later} basePath="/hod/marks" empty="Nothing yet." />
      </Card>
    </>
  );
}
