import type { Metadata } from "next";
import Link from "next/link";
import { requireStudent } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ResultsView } from "@/components/results-view";

export const metadata: Metadata = { title: "Results" };

export default async function StudentResultsPage() {
  const { student } = await requireStudent();
  return (
    <>
      <PageHeader
        title="My results"
        subtitle={
          <Link href={`/report-card/${student.id}`} className="text-brand-700 hover:underline">
            Report card (print or save as PDF)
          </Link>
        }
      />
      <ResultsView studentId={student.id} />
    </>
  );
}
