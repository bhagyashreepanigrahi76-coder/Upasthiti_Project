import type { Metadata } from "next";
import Link from "next/link";
import { getTeacherProfile, requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { KIND_LABEL, STATUS_LABEL, schemeFor } from "@/lib/results";
import { Badge, Card, EmptyState, PageHeader, Table, td } from "@/components/ui";

export const metadata: Metadata = { title: "Marks entry" };

const TONE = { DRAFT: "amber", SUBMITTED: "brand", VERIFIED: "brand", LOCKED: "slate", PUBLISHED: "green" } as const;

export default async function TeacherMarksPage() {
  const user = await requirePortal("teacher");
  const teacher = await getTeacherProfile(user.id);
  if (!teacher) return <EmptyState>Your teacher profile has not been set up yet.</EmptyState>;
  const [settings, ay] = await Promise.all([getSettings(), db.academicYear.findFirst({ where: { isCurrent: true } })]);
  const mappings = await db.teacherSubject.findMany({
    where: { teacherId: teacher.id, academicYearId: ay?.id },
    include: { subject: true, section: { include: { department: true } } },
    orderBy: [{ section: { year: "asc" } }, { subject: { code: "asc" } }],
  });
  const assessments = await db.assessment.findMany({
    where: { OR: mappings.map((m) => ({ subjectId: m.subjectId, sectionId: m.sectionId, academicYearId: m.academicYearId })) },
    include: { _count: { select: { marks: true } } },
  });

  return (
    <>
      <PageHeader title="Marks entry" subtitle="Enter marks per assessment, then submit for HOD verification (FR-21, FR-23)." />
      {mappings.length === 0 ? (
        <EmptyState>No subjects are assigned to you this year.</EmptyState>
      ) : (
        <div className="space-y-4">
          {mappings.map((m) => (
            <Card key={m.id} title={`${m.subject.code} · ${m.subject.name} · ${m.section.department.code} ${m.section.year}-${m.section.name}`}>
              <Table head={["Assessment", "Max", "Weight", "Status", ""]}>
                {schemeFor(m.subject.type, settings).map((item) => {
                  const a = assessments.find((x) => x.subjectId === m.subjectId && x.sectionId === m.sectionId && x.kind === item.kind);
                  return (
                    <tr key={item.kind}>
                      <td className={td}>{KIND_LABEL[item.kind]}</td>
                      <td className={`${td} tabular-nums`}>{a?.maxMarks ?? item.maxMarks}</td>
                      <td className={`${td} tabular-nums`}>{a?.weightage ?? item.weightage}%</td>
                      <td className={td}>
                        {a ? <Badge tone={TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge> : <Badge>Not started</Badge>}
                        {a?.returnNote && a.status === "DRAFT" && <Badge tone="red">Returned</Badge>}
                        {a && <span className="ml-2 text-xs text-slate-500">{a._count.marks} entered</span>}
                      </td>
                      <td className={`${td} text-right`}>
                        <Link href={`/teacher/marks/${m.id}/${item.kind}`} className="text-sm font-medium text-brand-700 hover:underline">
                          {!a || a.status === "DRAFT" ? "Enter marks" : "View"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </Table>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
