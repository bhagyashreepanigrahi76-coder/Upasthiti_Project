import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, EmptyState, Table, td } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/forms";
import { Field, Select } from "@/components/form-fields";
import { createMapping, deleteMapping } from "../actions";

export const metadata: Metadata = { title: "Teacher mapping" };

type Props = { searchParams: Promise<{ dept?: string }> };

export default async function MappingPage({ searchParams }: Props) {
  await requireRole("ADMIN");
  const { dept } = await searchParams;

  const [departments, currentYear] = await Promise.all([
    db.department.findMany({ orderBy: { code: "asc" } }),
    db.academicYear.findFirst({ where: { isCurrent: true } }),
  ]);
  const deptId = dept ?? departments[0]?.id;

  const [mappings, teachers, subjects, sections] = await Promise.all([
    db.teacherSubject.findMany({
      where: { section: { departmentId: deptId }, academicYearId: currentYear?.id },
      include: { teacher: { include: { user: true } }, subject: true, section: true },
      orderBy: [{ section: { year: "asc" } }, { section: { name: "asc" } }, { subject: { code: "asc" } }],
    }),
    // Any teacher can be mapped (e.g. a Maths teacher teaching CS students).
    db.teacher.findMany({ include: { user: true, department: true }, orderBy: { user: { name: "asc" } } }),
    db.subject.findMany({ where: { departmentId: deptId }, orderBy: { code: "asc" } }),
    db.section.findMany({
      where: { departmentId: deptId, academicYearId: currentYear?.id },
      orderBy: [{ year: "asc" }, { name: "asc" }],
    }),
  ]);

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {departments.map((d) => (
          <Link
            key={d.id}
            href={`/admin/academic/mapping?dept=${d.id}`}
            className={`rounded-full px-3 py-1 ${deptId === d.id ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700"}`}
          >
            {d.code}
          </Link>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title={`Who teaches what (${mappings.length})`} className="xl:col-span-2">
          {mappings.length === 0 ? (
            <EmptyState>No subjects mapped in this department yet.</EmptyState>
          ) : (
            <Table head={["Section", "Subject", "Teacher", ""]}>
              {mappings.map((m) => (
                <tr key={m.id}>
                  <td className={td}>
                    Year {m.section.year} · {m.section.name}
                  </td>
                  <td className={td}>
                    <span className="font-mono text-xs text-slate-500">{m.subject.code}</span> {m.subject.name}
                  </td>
                  <td className={td}>{m.teacher.user.name}</td>
                  <td className={`${td} text-right`}>
                    <ActionButton action={deleteMapping} fields={{ id: m.id }} label="Remove" tone="danger" />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Assign a subject" className="h-fit">
          <ActionForm action={createMapping} submitLabel="Assign">
            <Field label="Section" name="sectionId">
              <Select
                name="sectionId"
                placeholder="Choose…"
                options={sections.map((s) => ({ value: s.id, label: `Year ${s.year} · Section ${s.name}` }))}
              />
            </Field>
            <Field label="Subject" name="subjectId" hint="Must be for the same year as the section.">
              <Select
                name="subjectId"
                placeholder="Choose…"
                options={subjects.map((s) => ({ value: s.id, label: `Y${s.year} ${s.code} · ${s.name}` }))}
              />
            </Field>
            <Field label="Teacher" name="teacherId">
              <Select
                name="teacherId"
                placeholder="Choose…"
                options={teachers.map((t) => ({ value: t.id, label: `${t.user.name} (${t.department.code})` }))}
              />
            </Field>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
