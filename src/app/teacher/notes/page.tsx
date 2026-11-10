import type { Metadata } from "next";
import { getTeacherProfile, requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { NOTES_MAX_MB } from "@/lib/notes";
import { PageHeader, Card, EmptyState, StatCard } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { Field, Input, Select, Textarea } from "@/components/form-fields";
import { NotesBrowser } from "@/components/notes-browser";
import { uploadNote } from "@/app/notes-actions/actions";

export const metadata: Metadata = { title: "Notes" };

type Props = { searchParams: Promise<{ q?: string; subject?: string }> };

export default async function TeacherNotesPage({ searchParams }: Props) {
  const user = await requirePortal("teacher");
  const { q, subject } = await searchParams;
  const teacher = await getTeacherProfile(user.id);
  const maps = teacher
    ? await db.teacherSubject.findMany({ where: { teacherId: teacher.id }, include: { subject: true, section: { include: { department: true } } }, orderBy: { subject: { code: "asc" } } })
    : [];
  const subjects = [...new Map(maps.map((m) => [m.subjectId, m.subject])).values()];
  const [mine, views] = await Promise.all([
    db.note.count({ where: { uploadedById: user.id } }),
    db.note.aggregate({ where: { uploadedById: user.id }, _sum: { downloads: true } }),
  ]);

  return (
    <>
      <PageHeader title="Study notes" subtitle="Share notes, slides and question banks with your classes. Students are notified." />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Notes you shared" value={mine} />
        <StatCard label="Times opened" value={views._sum.downloads ?? 0} />
        <StatCard label="Your subjects" value={subjects.length} />
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Upload notes" className="h-fit">
          {subjects.length === 0 ? (
            <EmptyState>No subjects are assigned to you yet.</EmptyState>
          ) : (
            <ActionForm action={uploadNote} submitLabel="Upload and notify students" pendingLabel="Uploading…" resetOnSuccess>
              <Field label="Subject" name="subjectId">
                <Select name="subjectId" options={subjects.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} />
              </Field>
              <Field label="For" name="sectionId">
                <Select
                  name="sectionId"
                  placeholder="All sections of that year"
                  options={maps.map((m) => ({ value: m.sectionId, label: `${m.subject.code}: ${m.section.department.code} ${m.section.year}-${m.section.name} only` }))}
                />
              </Field>
              <Field label="Title" name="title">
                <Input name="title" placeholder="Unit 2: Pointers and arrays" />
              </Field>
              <Field label="Short description" name="description">
                <Textarea name="description" rows={2} placeholder="What's inside, which exam it helps with" />
              </Field>
              <Field label="Topics (for search)" name="tags" hint="Separate with commas, e.g. pointers, arrays, unit 2">
                <Input name="tags" />
              </Field>
              <Field label="File" name="file" hint={`PDF, Word, PowerPoint or image, up to ${NOTES_MAX_MB} MB`}>
                <input
                  id="file"
                  name="file"
                  type="file"
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg"
                  className="block w-full text-sm file:mr-2 file:rounded-md file:border-0 file:bg-haldi-50 file:px-3 file:py-2 file:text-sm file:text-haldi-600"
                />
              </Field>
            </ActionForm>
          )}
        </Card>
        <div className="xl:col-span-2">
          <NotesBrowser user={user} q={q} subjectId={subject} title="Notes for your department and subjects" />
        </div>
      </div>
    </>
  );
}
