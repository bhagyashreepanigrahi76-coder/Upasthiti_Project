import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge, Card, Table, td } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/forms";
import { Field, FieldGrid, Input } from "@/components/form-fields";
import { createAcademicYear, deleteDepartment, saveDepartment, setCurrentAcademicYear } from "./actions";

export const metadata: Metadata = { title: "Academic setup" };

type Props = { searchParams: Promise<{ edit?: string }> };

export default async function AcademicYearsPage({ searchParams }: Props) {
  await requireRole("ADMIN");
  const { edit } = await searchParams;

  const [years, departments] = await Promise.all([
    db.academicYear.findMany({ orderBy: { startDate: "desc" } }),
    db.department.findMany({
      orderBy: { code: "asc" },
      include: { _count: { select: { sections: true, subjects: true, teachers: true, students: true } } },
    }),
  ]);
  const editing = departments.find((d) => d.id === edit);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card title="Academic years">
        <Table head={["Year", "Starts", "Ends", ""]}>
          {years.map((y) => (
            <tr key={y.id}>
              <td className={`${td} font-medium`}>{y.name}</td>
              <td className={td}>{iso(y.startDate)}</td>
              <td className={td}>{iso(y.endDate)}</td>
              <td className={`${td} text-right`}>
                {y.isCurrent ? (
                  <Badge tone="green">Current</Badge>
                ) : (
                  <ActionButton action={setCurrentAcademicYear} fields={{ id: y.id }} label="Make current" />
                )}
              </td>
            </tr>
          ))}
        </Table>
        <div className="mt-5 border-t border-slate-100 pt-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-800">Add academic year</h3>
          <ActionForm action={createAcademicYear} submitLabel="Add year" resetOnSuccess>
            <FieldGrid cols={3}>
              <Field label="Name" name="name">
                <Input name="name" placeholder="2027-28" />
              </Field>
              <Field label="Start date" name="startDate">
                <Input name="startDate" type="date" />
              </Field>
              <Field label="End date" name="endDate">
                <Input name="endDate" type="date" />
              </Field>
            </FieldGrid>
          </ActionForm>
        </div>
      </Card>

      <Card title="Departments and programmes">
        <Table head={["Code", "Programme", "Sections", "Students", ""]}>
          {departments.map((d) => (
            <tr key={d.id}>
              <td className={`${td} font-mono font-medium`}>{d.code}</td>
              <td className={td}>
                {d.programme}
                <span className="block text-xs text-slate-500">{d.name}</span>
              </td>
              <td className={`${td} tabular-nums`}>{d._count.sections}</td>
              <td className={`${td} tabular-nums`}>{d._count.students}</td>
              <td className={`${td} whitespace-nowrap text-right`}>
                <Link href={`/admin/academic?edit=${d.id}`} className="mr-2 text-xs font-medium text-brand-700 hover:underline">
                  Edit
                </Link>
                <ActionButton
                  action={deleteDepartment}
                  fields={{ id: d.id }}
                  label="Delete"
                  tone="danger"
                  confirmText={`Delete department ${d.code}?`}
                />
              </td>
            </tr>
          ))}
        </Table>
        <div className="mt-5 border-t border-slate-100 pt-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-800">
            {editing ? `Edit ${editing.code}` : "Add department"}
          </h3>
          <ActionForm
            key={editing?.id ?? "new"}
            action={saveDepartment}
            submitLabel={editing ? "Save changes" : "Add department"}
            resetOnSuccess={!editing}
          >
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <FieldGrid cols={3}>
              <Field label="Code" name="code">
                <Input name="code" defaultValue={editing?.code} placeholder="MATH" />
              </Field>
              <Field label="Department name" name="name">
                <Input name="name" defaultValue={editing?.name} placeholder="Mathematics" />
              </Field>
              <Field label="Programme" name="programme">
                <Input name="programme" defaultValue={editing?.programme} placeholder="B.Sc. Mathematics" />
              </Field>
            </FieldGrid>
          </ActionForm>
          {editing && (
            <Link href="/admin/academic" className="mt-2 inline-block text-xs text-slate-500 hover:underline">
              Cancel editing
            </Link>
          )}
        </div>
      </Card>
    </div>
  );
}
