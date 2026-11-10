import type { Metadata } from "next";
import { requirePortal } from "@/lib/auth";
import { AssessmentReview } from "@/components/assessment-review";

export const metadata: Metadata = { title: "Review marks" };

type Props = { params: Promise<{ id: string }> };

export default async function HodAssessmentPage({ params }: Props) {
  const user = await requirePortal("hod");
  const { id } = await params;
  return <AssessmentReview user={user} assessmentId={id} backHref="/hod/marks" />;
}
