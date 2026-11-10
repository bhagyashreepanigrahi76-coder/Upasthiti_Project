import type { Metadata } from "next";
import { requireStudent } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { NotesBrowser } from "@/components/notes-browser";

export const metadata: Metadata = { title: "Notes" };

type Props = { searchParams: Promise<{ q?: string; subject?: string }> };

export default async function StudentNotesPage({ searchParams }: Props) {
  const { user, student } = await requireStudent();
  const { q, subject } = await searchParams;
  return (
    <>
      <PageHeader title="Study notes" subtitle={`Notes shared by your teachers for ${student.department.code} Year ${student.year}. Search by topic to find what you need.`} />
      <NotesBrowser user={user} q={q} subjectId={subject} />
    </>
  );
}
