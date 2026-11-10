import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/config";
import type { ImportRow } from "@/lib/importers";
import { Badge, Card, EmptyState, PageHeader, Table, td } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { Field, Select } from "@/components/form-fields";
import { commitImport, discardImport, previewImport } from "./actions";

export const metadata: Metadata = { title: "Bulk import" };

type Props = { searchParams: Promise<{ job?: string }> };

export default async function ImportPage({ searchParams }: Props) {
  await requireRole("ADMIN");
  const { job: jobId } = await searchParams;
  const [job, recent] = await Promise.all([
    jobId ? db.importJob.findUnique({ where: { id: jobId } }) : null,
    db.importJob.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  const rows = job ? (JSON.parse(job.payload) as ImportRow<unknown>[]) : [];
  const invalid = rows.filter((r) => !r.data);

  return (
    <>
      <PageHeader title="Bulk import" subtitle="Add students or teachers from a CSV or Excel (.xlsx) file." />

      {job ? (
        <Card
          title={`${job.kind === "STUDENTS" ? "Students" : "Teachers"} · ${job.fileName}`}
          action={
            <Badge tone={job.status === "PREVIEW" ? "amber" : job.status === "COMMITTED" ? "green" : "slate"}>
              {job.status}
            </Badge>
          }
        >
          <p className="mb-4 text-sm text-slate-700">
            {job.totalRows} rows · <span className="font-medium text-emerald-700">{job.validRows} ready</span>
            {invalid.length > 0 && (
              <>
                {" · "}
                <span className="font-medium text-red-700">{invalid.length} with errors (will be skipped)</span>
              </>
            )}
          </p>

          {job.status === "PREVIEW" && (
            <div className="mb-5 flex flex-wrap items-start gap-3">
              {job.validRows > 0 && (
                <ActionForm
                  action={commitImport}
                  submitLabel={`Import ${job.validRows} valid row${job.validRows === 1 ? "" : "s"}`}
                  pendingLabel="Importing…"
                  tone="success"
                  className="space-y-2"
                >
                  <input type="hidden" name="id" value={job.id} />
                </ActionForm>
              )}
              <ActionForm action={discardImport} submitLabel="Discard" tone="secondary" className="space-y-2">
                <input type="hidden" name="id" value={job.id} />
              </ActionForm>
            </div>
          )}

          {rows.length > 0 && (
            <Table head={["Line", "College ID", "Name", "Result"]}>
              {[...invalid, ...rows.filter((r) => r.data)].slice(0, 300).map((r) => (
                <tr key={r.line}>
                  <td className={`${td} tabular-nums text-slate-500`}>{r.line}</td>
                  <td className={`${td} font-mono text-xs`}>{r.raw.college_id}</td>
                  <td className={td}>{r.raw.name}</td>
                  <td className={td}>
                    {r.errors.length === 0 ? (
                      <Badge tone="green">OK</Badge>
                    ) : (
                      <ul className="list-inside list-disc text-xs text-red-700">
                        {r.errors.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
          {rows.length > 300 && <p className="mt-2 text-xs text-slate-500">Showing errors first, then the first rows.</p>}
          <Link href="/admin/import" className="mt-4 inline-block text-sm text-brand-700 hover:underline">
            Start another import
          </Link>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="1. Upload a file">
            <ActionForm action={previewImport} submitLabel="Check file" pendingLabel="Checking…">
              <Field label="What are you importing?" name="kind">
                <Select
                  name="kind"
                  options={[
                    { value: "STUDENTS", label: "Students (with parent contact)" },
                    { value: "TEACHERS", label: "Teachers" },
                  ]}
                />
              </Field>
              <Field label="File" name="file" hint="CSV or .xlsx, up to 5 MB and 5,000 rows. The first row must be the header.">
                <input
                  id="file"
                  name="file"
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium"
                />
              </Field>
            </ActionForm>
            <p className="mt-4 text-sm text-slate-600">
              Nothing is saved until you review the check and confirm.
            </p>
          </Card>

          <Card title="Templates and columns">
            <ul className="mb-4 space-y-1 text-sm">
              <li>
                <a href="/admin/import/template/students.csv" className="text-brand-700 hover:underline">
                  Download student template (CSV)
                </a>
              </li>
              <li>
                <a href="/admin/import/template/teachers.csv" className="text-brand-700 hover:underline">
                  Download teacher template (CSV)
                </a>
              </li>
            </ul>
            <p className="text-sm text-slate-600">
              <strong>Students:</strong> name, college_id, year, department (code), section, parent_name, parent_email
              are required. Optional: parent_phone, email, phone, admission_year, date_of_birth, batch.
            </p>
            <p className="mt-2 text-sm text-slate-600">
              <strong>Teachers:</strong> name, college_id, department and email are required. roles can be
              TEACHER, HOD, MENTOR (separate with ;). A MENTOR needs mentor_section such as 1-A.
            </p>
          </Card>
        </div>
      )}

      <Card title="Recent imports" className="mt-6">
        {recent.length === 0 ? (
          <EmptyState>No imports yet.</EmptyState>
        ) : (
          <Table head={["When", "Type", "File", "Rows", "Status"]}>
            {recent.map((j) => (
              <tr key={j.id}>
                <td className={`${td} whitespace-nowrap text-xs`}>{formatDateTime(j.createdAt)}</td>
                <td className={td}>{j.kind === "STUDENTS" ? "Students" : "Teachers"}</td>
                <td className={td}>
                  <Link href={`/admin/import?job=${j.id}`} className="text-brand-700 hover:underline">
                    {j.fileName}
                  </Link>
                </td>
                <td className={`${td} tabular-nums`}>
                  {j.validRows}/{j.totalRows}
                </td>
                <td className={td}>
                  <Badge tone={j.status === "COMMITTED" ? "green" : j.status === "PREVIEW" ? "amber" : "slate"}>{j.status}</Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
