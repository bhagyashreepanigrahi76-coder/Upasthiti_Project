import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { toDateKey, formatDateKey } from "@/lib/dates";
import { Badge, Card, EmptyState, PageHeader, Table, td } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/forms";
import { Field, FieldGrid, Input, Select, Textarea } from "@/components/form-fields";
import { CalendarView } from "@/components/calendar-view";
import { TYPE_LABEL } from "@/components/month-calendar";
import { createEvent, deleteEvent, importEvents } from "./actions";

export const metadata: Metadata = { title: "Academic calendar" };

type Props = { searchParams: Promise<{ month?: string }> };

export default async function AdminCalendarPage({ searchParams }: Props) {
  await requireRole("ADMIN");
  const { month } = await searchParams;
  const today = toDateKey(new Date());
  const [departments, upcoming] = await Promise.all([
    db.department.findMany({ orderBy: { code: "asc" } }),
    db.calendarEvent.findMany({
      where: { endDate: { gte: today } },
      orderBy: { startDate: "asc" },
      take: 40,
      include: { department: true },
    }),
  ]);

  return (
    <>
      <PageHeader title="Academic calendar" subtitle="Holidays and exam days are excluded from attendance. Changes notify students and teachers." />

      <CalendarView month={month} basePath="/admin/calendar" />

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Add an entry" className="xl:col-span-1">
          <ActionForm action={createEvent} submitLabel="Add to calendar" resetOnSuccess>
            <Field label="Title" name="title">
              <Input name="title" placeholder="Diwali holiday" />
            </Field>
            <Field label="Type" name="type">
              <Select name="type" options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
            </Field>
            <FieldGrid>
              <Field label="From" name="startDate">
                <Input name="startDate" type="date" />
              </Field>
              <Field label="To (optional)" name="endDate">
                <Input name="endDate" type="date" />
              </Field>
              <Field label="Department" name="departmentId" hint="Empty = whole college">
                <Select name="departmentId" placeholder="All" options={departments.map((d) => ({ value: d.id, label: d.code }))} />
              </Field>
              <Field label="Year" name="year">
                <Select name="year" placeholder="All" options={[1, 2, 3].map((y) => ({ value: String(y), label: `Year ${y}` }))} />
              </Field>
            </FieldGrid>
            <Field label="Description" name="description">
              <Textarea name="description" rows={2} />
            </Field>
          </ActionForm>
        </Card>

        <Card title="Upcoming entries" className="xl:col-span-2">
          {upcoming.length === 0 ? (
            <EmptyState>No upcoming entries.</EmptyState>
          ) : (
            <Table head={["Dates", "Title", "Type", "Applies to", ""]}>
              {upcoming.map((e) => (
                <tr key={e.id}>
                  <td className={`${td} whitespace-nowrap text-xs`}>
                    {formatDateKey(e.startDate)}
                    {e.endDate !== e.startDate && <> – {formatDateKey(e.endDate)}</>}
                  </td>
                  <td className={td}>{e.title}</td>
                  <td className={td}>
                    <Badge tone={e.type === "HOLIDAY" ? "red" : e.type === "EXAM" ? "brand" : "slate"}>{TYPE_LABEL[e.type]}</Badge>
                  </td>
                  <td className={`${td} text-xs`}>
                    {[e.department?.code ?? "All departments", e.year ? `Year ${e.year}` : "all years"].join(", ")}
                  </td>
                  <td className={`${td} text-right`}>
                    <ActionButton action={deleteEvent} fields={{ id: e.id }} label="Delete" tone="danger" confirmText={`Delete "${e.title}"?`} />
                  </td>
                </tr>
              ))}
            </Table>
          )}

          <div className="mt-5 border-t border-slate-100 pt-4">
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Import from CSV or Excel</h3>
            <p className="mb-3 text-xs text-slate-600">
              Columns: <code>start_date, end_date, type, title, department, year, description</code>. Type is HOLIDAY, EXAM,
              WORKING_SATURDAY or EVENT. Dates as YYYY-MM-DD or DD/MM/YYYY. If any row has an error, nothing is imported.
            </p>
            <ActionForm action={importEvents} submitLabel="Import" pendingLabel="Importing…" encType="multipart/form-data" className="flex flex-wrap items-end gap-3">
              <input
                name="file"
                type="file"
                accept=".csv,.xlsx"
                aria-label="Calendar file"
                className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium"
              />
            </ActionForm>
          </div>
        </Card>
      </div>
    </>
  );
}
