import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, EmptyState, PageHeader, Table, td } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { Checkbox, Field, Input, Select } from "@/components/form-fields";
import { promoteStudents } from "./actions";

export const metadata: Metadata = { title: "Year-end promotion" };

export default async function PromotionPage() {
  await requireRole("ADMIN");
  const current = await db.academicYear.findFirst({ where: { isCurrent: true } });
  const [later, counts, passedOut] = await Promise.all([
    db.academicYear.findMany({ where: current ? { startDate: { gt: current.startDate } } : {}, orderBy: { startDate: "asc" } }),
    db.student.groupBy({ by: ["departmentId", "year"], where: { status: "ACTIVE", section: { academicYearId: current?.id } }, _count: true }),
    db.student.count({ where: { status: "PASSED_OUT" } }),
  ]);
  const departments = await db.department.findMany({ orderBy: { code: "asc" } });
  const n = (d: string, y: number) => counts.find((c) => c.departmentId === d && c.year === y)?._count ?? 0;

  return (
    <>
      <PageHeader title="Year-end promotion" subtitle={`Current academic year: ${current?.name ?? "not set"}. Passed-out students on record: ${passedOut}.`} />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="What will happen" className="xl:col-span-2">
          <Table head={["Department", "Year 1 → Year 2", "Year 2 → Year 3", "Year 3 → passed out"]}>
            {departments.map((d) => (
              <tr key={d.id}>
                <td className={`${td} font-medium`}>{d.code}</td>
                <td className={`${td} tabular-nums`}>{n(d.id, 1)}</td>
                <td className={`${td} tabular-nums`}>{n(d.id, 2)}</td>
                <td className={`${td} tabular-nums`}>{n(d.id, 3)}</td>
              </tr>
            ))}
          </Table>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Students move into sections with the same name in the new year (created if missing). Year 1 sections are also created for new admissions.</li>
            <li>Passed-out students can no longer sign in, but their attendance, marks and results are kept.</li>
            <li>Lab batches and class coordinators are cleared, because they change every year.</li>
          </ul>
        </Card>
        <Card title="Promote" className="h-fit">
          {later.length === 0 ? (
            <EmptyState>
              First <Link href="/admin/academic" className="text-brand-700 underline">create the next academic year</Link>.
            </EmptyState>
          ) : (
            <ActionForm action={promoteStudents} submitLabel="Promote students" tone="danger" confirmText="Promote every student now? This cannot be undone automatically.">
              <Field label="Into academic year" name="targetYearId">
                <Select name="targetYearId" options={later.map((y) => ({ value: y.id, label: y.name }))} />
              </Field>
              <Checkbox name="makeCurrent" label="Make it the current academic year" defaultChecked />
              <Field label="Type PROMOTE to confirm" name="confirm">
                <Input name="confirm" autoComplete="off" />
              </Field>
            </ActionForm>
          )}
        </Card>
      </div>
    </>
  );
}
