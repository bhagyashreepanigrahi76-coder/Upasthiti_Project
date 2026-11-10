import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { AssessmentReview } from "@/components/assessment-review";

export const metadata: Metadata = { title: "Result" };

type Props = { params: Promise<{ id: string }> };

export default async function AdminAssessmentPage({ params }: Props) {
  const user = await requireRole("ADMIN");
  const { id } = await params;
  return <AssessmentReview user={user} assessmentId={id} backHref="/admin/results" />;
}
