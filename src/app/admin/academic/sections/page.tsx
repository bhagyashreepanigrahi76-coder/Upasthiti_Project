import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge, Card, EmptyState } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/forms";
import { Field, FieldGrid, Input, Select } from "@/components/form-fields";
import { createBatch, createSection, deleteBatch, deleteSection, splitIntoBatches } from "../actions";

export const metadata: Metadata = { title: "Sections & batches" };

export default async function SectionsPage() {
  await requireRole("ADMIN");

  const [currentYear, departments] = await Promise.all([
    db.academicYear.findFirst({ where: { isCurrent: true } }),
    db.department.findMany({ orderBy: { code: "asc" } }),
  ]);
  const sections = currentYear
    ? await db.section.findMany({
        where: { academicYearId: currentYear.id },
        orderBy: [{ department: { code: "asc" } }, { year: "asc" }, { name: "asc" }],
        include: {
          department: true,
          _count: { select: { students: true } },
          batches: { orderBy: { name: "asc" }, include: { _count: { select: { students: true } } } },
        },
      })
    : [];

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        {!currentYear && <EmptyState>Set a current academic year first.</EmptyState>}
        {currentYear && sections.length === 0 && <EmptyState>No sections yet for {currentYear.name}.</EmptyState>}
        {sections.map((s) => {
          const unassigned = s._count.students - s.batches.reduce((n, b) => n + b._count.students, 0);
          return (
            <Card
              key={s.id}
              title={`${s.department.code} · Year ${s.year} · Section ${s.name}`}
              action={
                <ActionButton
                  action={deleteSection}
                  fields={{ id: s.id }}
                  label="Delete section"
                  tone="danger"
                  confirmText="Delete this section?"
                />
              }
            >
              <p className="mb-3 text-sm text-slate-600">
                {s._count.students} students
                {s.batches.length > 0 && unassigned > 0 && (
                  <>
                    {" · "}
                    <Badge tone="amber">{unassigned} not in a batch</Badge>
                  </>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                {s.batches.map((b) => (
                  <div key={b.id} className="flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1">
                    <span className="text-sm">
                      {b.name} <span className="text-xs text-slate-500">({b._count.students})</span>
                    </span>
                    <ActionButton
                      action={deleteBatch}
                      fields={{ id: b.id }}
                      label="×"
                      tone="danger"
                      confirmText={`Delete ${b.name}?`}
                    />
                  </div>
                ))}
                {s.batches.length === 0 && <span className="text-xs text-slate-500">No lab batches.</span>}
              </div>
              <div className="mt-4 grid gap-4 border-t border-slate-100 pt-3 sm:grid-cols-2">
                <ActionForm action={createBatch} submitLabel="Add batch" resetOnSuccess className="flex items-end gap-2">
                  <input type="hidden" name="sectionId" value={s.id} />
                  <Field label="New batch" name="name" className="flex-1">
                    <Input name="name" placeholder="Batch 3" />
                  </Field>
                </ActionForm>
                <ActionForm
                  action={splitIntoBatches}
                  submitLabel="Split"
                  tone="secondary"
                  className="flex items-end gap-2"
                  confirmText="Reassign every student in this section to batches by roll number?"
                >
                  <input type="hidden" name="sectionId" value={s.id} />
                  <Field label="Split students into" name="count" className="flex-1">
                    <Select
                      name="count"
                      defaultValue="2"
                      options={[2, 3, 4].map((n) => ({ value: String(n), label: `${n} batches` }))}
                    />
                  </Field>
                </ActionForm>
              </div>
            </Card>
          );
        })}
      </div>

      <Card title={`Add section${currentYear ? ` (${currentYear.name})` : ""}`} className="h-fit">
        <ActionForm action={createSection} submitLabel="Add section" resetOnSuccess>
          <Field label="Department" name="departmentId">
            <Select
              name="departmentId"
              placeholder="Choose…"
              options={departments.map((d) => ({ value: d.id, label: `${d.code} · ${d.programme}` }))}
            />
          </Field>
          <FieldGrid>
            <Field label="Year" name="year">
              <Select name="year" options={[1, 2, 3].map((y) => ({ value: String(y), label: `Year ${y}` }))} />
            </Field>
            <Field label="Section" name="name">
              <Input name="name" placeholder="C" />
            </Field>
          </FieldGrid>
        </ActionForm>
      </Card>
    </div>
  );
}
