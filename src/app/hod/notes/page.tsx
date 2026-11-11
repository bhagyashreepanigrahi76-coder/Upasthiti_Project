import type { Metadata } from "next";
import { requirePortal } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { NotesBrowser } from "@/components/notes-browser";

export const metadata: Metadata = { title: "Department notes" };

type Props = { searchParams: Promise<{ q?: string; subject?: string }> };

export default async function HodNotesPage({ searchParams }: Props) {
  const user = await requirePortal("hod");
  const { q, subject } = await searchParams;
  return (
    <>
      <PageHeader title="Department notes" subtitle="Everything your teachers have shared. You can remove notes that shouldn't be there." />
      <NotesBrowser user={user} q={q} subjectId={subject} title="All department notes" />
    </>
  );
}
