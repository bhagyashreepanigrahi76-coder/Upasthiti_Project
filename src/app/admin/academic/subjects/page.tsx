import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge, Card, Table, td } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/forms";
import { Field, FieldGrid, Input, Select } from "@/components/form-fields";
import { deleteSubject, saveSubject } from "../actions";

export const metadata: Metadata = { title: "Subjects" };

type Props = { searchParams: Promise<{ edit?: string; dept?: string }> };

export default async function SubjectsPage({ searchParams }: Props) {
  await requireRole("ADMIN");
  const { edit, dept } = await searchParams;

  const departments = await db.department.findMany({ orderBy: { code: "asc" } });
  const subjects = await db.subject.findMany({
    where: dept ? { departmentId: dept } : {},
    orderBy: [{ department: { code: "asc" } }, { semester: "asc" }, { code: "asc" }],
    include: { department: true, _count: { select: { teacherSubjects: true } } },
  });
  const editing = edit ? await db.subject.findUnique({ where: { id: edit } }) : null;

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card title={`Subjects (${subjects.length})`} className="xl:col-span-2">
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <Link
            href="/admin/academic/subjects"
            className={`rounded-full px-3 py-1 ${!dept ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700"}`}
          >
            All
          </Link>
          {departments.map((d) => (
            <Link
              key={d.id}
              href={`/admin/academic/subjects?dept=${d.id}`}
              className={`rounded-full px-3 py-1 ${dept === d.id ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700"}`}
            >
              {d.code}
            </Link>
          ))}
        </div>
        <Table head={["Code", "Subject", "Dept", "Year / Sem", "Type", "Classes", ""]}>
          {subjects.map((s) => (
            <tr key={s.id}>
              <td className={`${td} font-mono text-xs`}>{s.code}</td>
              <td className={td}>{s.name}</td>
              <td className={td}>{s.department.code}</td>
              <td className={td}>
                Y{s.year} · S{s.semester}
              </td>
              <td className={td}>
                <Badge tone={s.type === "PRACTICAL" ? "amber" : "slate"}>
                  {s.type === "PRACTICAL" ? "Practical" : "Theory"}
                </Badge>
              </td>
              <td className={`${td} tabular-nums`}>{s._count.teacherSubjects}</td>
              <td className={`${td} whitespace-nowrap text-right`}>
                <Link
                  href={`/admin/academic/subjects?edit=${s.id}${dept ? `&dept=${dept}` : ""}`}
                  className="mr-2 text-xs font-medium text-brand-700 hover:underline"
                >
                  Edit
                </Link>
                <ActionButton
                  action={deleteSubject}
                  fields={{ id: s.id }}
                  label="Delete"
                  tone="danger"
                  confirmText={`Delete ${s.code}?`}
                />
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title={editing ? `Edit ${editing.code}` : "Add subject"} className="h-fit">
        <ActionForm
          key={editing?.id ?? "new"}
          action={saveSubject}
          submitLabel={editing ? "Save changes" : "Add subject"}
          resetOnSuccess={!editing}
        >
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <FieldGrid>
            <Field label="Code" name="code">
              <Input name="code" defaultValue={editing?.code} placeholder="CS204" />
            </Field>
            <Field label="Credits" name="credits">
              <Input name="credits" type="number" min={0} max={10} defaultValue={editing?.credits ?? 4} />
            </Field>
          </FieldGrid>
          <Field label="Name" name="name">
            <Input name="name" defaultValue={editing?.name} placeholder="Object Oriented Programming" />
          </Field>
          <Field label="Department" name="departmentId">
            <Select
              name="departmentId"
              defaultValue={editing?.departmentId ?? dept ?? ""}
              placeholder="Choose…"
              options={departments.map((d) => ({ value: d.id, label: `${d.code} · ${d.programme}` }))}
            />
          </Field>
          <FieldGrid cols={3}>
            <Field label="Year" name="year">
              <Select
                name="year"
                defaultValue={String(editing?.year ?? 1)}
                options={[1, 2, 3].map((y) => ({ value: String(y), label: String(y) }))}
              />
            </Field>
            <Field label="Semester" name="semester">
              <Select
                name="semester"
                defaultValue={String(editing?.semester ?? 1)}
                options={[1, 2, 3, 4, 5, 6].map((s) => ({ value: String(s), label: String(s) }))}
              />
            </Field>
            <Field label="Type" name="type">
              <Select
                name="type"
                defaultValue={editing?.type ?? "THEORY"}
                options={[
                  { value: "THEORY", label: "Theory" },
                  { value: "PRACTICAL", label: "Practical" },
                ]}
              />
            </Field>
          </FieldGrid>
        </ActionForm>
        {editing && (
          <Link href="/admin/academic/subjects" className="mt-2 inline-block text-xs text-slate-500 hover:underline">
            Cancel editing
          </Link>
        )}
      </Card>
    </div>
  );
}
