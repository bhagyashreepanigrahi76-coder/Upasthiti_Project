import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { AssessmentKind } from "@prisma/client";
import { getTeacherProfile, requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { KIND_LABEL, STATUS_LABEL, schemeFor, showMark } from "@/lib/results";
import { Badge, Card, PageHeader, Table, td } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { MarksGrid } from "@/components/marks-grid";
import { ClassStats } from "@/components/class-stats";
import { uploadMarks } from "@/app/marks-actions/actions";

export const metadata: Metadata = { title: "Enter marks" };

type Props = { params: Promise<{ mappingId: string; kind: string }> };

export default async function EnterMarksPage({ params }: Props) {
  const user = await requirePortal("teacher");
  const { mappingId, kind } = await params;
  const [teacher, settings] = await Promise.all([getTeacherProfile(user.id), getSettings()]);
  const mapping = await db.teacherSubject.findUnique({ where: { id: mappingId }, include: { subject: true, section: { include: { department: true } } } });
  // Teachers see only their own subjects (PRD §6).
  if (!teacher || !mapping || mapping.teacherId !== teacher.id) notFound();
  const item = schemeFor(mapping.subject.type, settings).find((i) => i.kind === kind);
  if (!item) notFound();

  const [assessment, roster] = await Promise.all([
    db.assessment.findUnique({
      where: { subjectId_sectionId_academicYearId_kind: { subjectId: mapping.subjectId, sectionId: mapping.sectionId, academicYearId: mapping.academicYearId, kind: kind as AssessmentKind } },
      include: { marks: true },
    }),
    db.student.findMany({ where: { sectionId: mapping.sectionId, status: "ACTIVE" }, orderBy: { rollNo: "asc" }, include: { user: { select: { name: true } } } }),
  ]);
  const editable = !assessment || assessment.status === "DRAFT";
  const maxMarks = assessment?.maxMarks ?? item.maxMarks;
  const entryOf = (id: string) => assessment?.marks.find((m) => m.studentId === id);

  return (
    <>
      <PageHeader
        title={`${mapping.subject.code} · ${KIND_LABEL[item.kind]}`}
        subtitle={
          <>
            {mapping.subject.name} · {mapping.section.department.code} Year {mapping.section.year}-{mapping.section.name} · max {maxMarks}, weight{" "}
            {assessment?.weightage ?? item.weightage}% ·{" "}
            <Link href="/teacher/marks" className="text-brand-700 hover:underline">
              All subjects
            </Link>
          </>
        }
      >
        <Badge tone={editable ? "amber" : "green"}>{assessment ? STATUS_LABEL[assessment.status] : "Not started"}</Badge>
      </PageHeader>

      {assessment?.returnNote && assessment.status === "DRAFT" && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          Sent back by the HOD: “{assessment.returnNote}”
        </p>
      )}

      {assessment && assessment.marks.length > 0 && (
        <Card title="Class analytics" className="mb-6">
          <ClassStats
            maxMarks={maxMarks}
            passPercent={settings.passPercent}
            entries={assessment.marks.map((m) => {
              const s = roster.find((r) => r.id === m.studentId);
              return { marks: m.marks, absent: m.absent, name: s?.user.name ?? "?", rollNo: s?.rollNo ?? "" };
            })}
          />
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          {editable ? (
            <MarksGrid
              mappingId={mapping.id}
              kind={item.kind}
              maxMarks={maxMarks}
              rows={roster.map((s) => ({ id: s.id, name: s.user.name, rollNo: s.rollNo, value: showMark(entryOf(s.id)) }))}
            />
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-600">These marks are {STATUS_LABEL[assessment!.status].toLowerCase()} and can no longer be edited here.</p>
              <Table head={["Roll no", "Student", "Marks"]}>
                {roster.map((s) => (
                  <tr key={s.id}>
                    <td className={`${td} font-mono text-xs`}>{s.rollNo}</td>
                    <td className={td}>{s.user.name}</td>
                    <td className={`${td} tabular-nums`}>{showMark(entryOf(s.id)) || "–"}</td>
                  </tr>
                ))}
              </Table>
            </>
          )}
        </Card>

        {editable && (
          <Card title="Upload from Excel or CSV" className="h-fit">
            <p className="mb-3 text-xs text-slate-600">
              Columns <code>college_id</code> and <code>marks</code> (a number or AB). Uploaded marks go into the draft; check them and submit.
            </p>
            <ActionForm action={uploadMarks} submitLabel="Upload">
              <input type="hidden" name="mappingId" value={mapping.id} />
              <input type="hidden" name="kind" value={item.kind} />
              <input
                name="file"
                type="file"
                accept=".csv,.xlsx"
                aria-label="Marks file"
                className="block w-full text-sm file:mr-2 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
              />
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
