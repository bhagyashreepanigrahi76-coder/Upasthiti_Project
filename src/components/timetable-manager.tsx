import Link from "next/link";
import { notFound } from "next/navigation";
import { departmentsFor, type CurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateKey, isDateKey, toDateKey, WEEKDAY_SHORT } from "@/lib/dates";
import { getTimings, sectionDay, teacherWorkload, teachingPeriods } from "@/lib/timetable";
import { importTimetable, markPeriodChange, removePeriodChange } from "@/app/timetable-actions/actions";
import { Badge, Card, EmptyState, PageHeader, Table, td } from "./ui";
import { ActionButton, ActionForm } from "./forms";
import { Field, FieldGrid, Input, Select, inputClass } from "./form-fields";
import { TimetableEditor } from "./timetable-editor";
import { DayList, gridDays, gridRows } from "./timetable-views";

// Timetable management shared by the Admin portal (all sections) and the HOD
// portal (own departments only), per FR-66.

function editableDepartments(user: CurrentUser): string[] | null {
  return user.roles.includes("ADMIN") ? null : departmentsFor(user, "HOD");
}

export async function SectionList({ user, basePath }: { user: CurrentUser; basePath: string }) {
  const depts = editableDepartments(user);
  const today = toDateKey(new Date());
  const ay = await db.academicYear.findFirst({ where: { isCurrent: true } });
  const sections = await db.section.findMany({
    where: { academicYearId: ay?.id, ...(depts ? { departmentId: { in: depts } } : {}) },
    orderBy: [{ department: { code: "asc" } }, { year: "asc" }, { name: "asc" }],
    include: {
      department: true,
      timetables: { orderBy: { effectiveFrom: "desc" }, include: { _count: { select: { slots: true } } } },
    },
  });

  return (
    <Card title="Sections">
      {sections.length === 0 ? (
        <EmptyState>No sections to manage.</EmptyState>
      ) : (
        <Table head={["Section", "In force today", "Upcoming version", "Classes / week", ""]}>
          {sections.map((s) => {
            const current = s.timetables.find((t) => t.effectiveFrom <= today);
            const upcoming = s.timetables.filter((t) => t.effectiveFrom > today).at(-1);
            return (
              <tr key={s.id}>
                <td className={`${td} font-medium`}>
                  {s.department.code} · Year {s.year} · {s.name}
                </td>
                <td className={td}>{current ? `Since ${formatDateKey(current.effectiveFrom)}` : <Badge tone="amber">None</Badge>}</td>
                <td className={td}>{upcoming ? `From ${formatDateKey(upcoming.effectiveFrom)}` : "–"}</td>
                <td className={`${td} tabular-nums`}>{(upcoming ?? current)?._count.slots ?? 0}</td>
                <td className={`${td} text-right`}>
                  <Link href={`${basePath}/${s.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                    {current || upcoming ? "Edit" : "Create"}
                  </Link>
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </Card>
  );
}

export async function SectionEditor({
  user,
  sectionId,
  basePath,
  date,
}: {
  user: CurrentUser;
  sectionId: string;
  basePath: string;
  date?: string;
}) {
  const section = await db.section.findUnique({
    where: { id: sectionId },
    include: { department: true, batches: { orderBy: { name: "asc" } } },
  });
  if (!section) notFound();
  const depts = editableDepartments(user);
  if (depts && !depts.includes(section.departmentId)) notFound();

  const today = toDateKey(new Date());
  const changeDate = isDateKey(date) && date >= today ? date : today;
  const [timings, versions, subjects, teachers, rooms, workload, day, changes] = await Promise.all([
    getTimings(),
    db.timetable.findMany({
      where: { sectionId },
      orderBy: { effectiveFrom: "desc" },
      include: { slots: true },
    }),
    db.subject.findMany({ where: { departmentId: section.departmentId, year: section.year }, orderBy: { code: "asc" } }),
    db.teacher.findMany({ include: { user: { select: { name: true } }, department: true }, orderBy: { user: { name: "asc" } } }),
    db.room.findMany({ orderBy: { name: "asc" } }),
    teacherWorkload(today),
    sectionDay(sectionId, changeDate),
    db.periodChange.findMany({
      where: { sectionId, dateKey: { gte: today } },
      orderBy: [{ dateKey: "asc" }, { periodNumber: "asc" }],
      include: { substitute: { include: { user: { select: { name: true } } } }, subject: true },
    }),
  ]);

  const newest = versions[0];
  const current = versions.find((v) => v.effectiveFrom <= today);
  const base = newest;
  const days = gridDays(timings).map((dow) => ({
    dow,
    label: WEEKDAY_SHORT[dow],
    periods: teachingPeriods(timings, dow).map((p) => ({ number: p.periodNumber!, time: `${p.startTime}–${p.endTime}` })),
  }));
  const teacherOptions = teachers.map((t) => ({
    value: t.id,
    label: `${t.user.name} (${t.department.code}, ${workload.get(t.id) ?? 0}/wk)`,
  }));
  const usedTeacherIds = [...new Set((current ?? newest)?.slots.map((s) => s.teacherId).filter((x): x is string => !!x) ?? [])];
  const label = `${section.department.code} · Year ${section.year} · Section ${section.name}`;

  return (
    <>
      <PageHeader
        title={`Timetable · ${label}`}
        subtitle={
          <>
            <Link href={basePath} className="text-brand-700 hover:underline">
              All sections
            </Link>{" "}
            ·{" "}
            <Link href={`/timetable-print/section/${section.id}`} className="text-brand-700 hover:underline">
              Printable view
            </Link>
          </>
        }
      />

      {timings.WEEKDAY.length === 0 ? (
        <EmptyState>Set up period timings first (Admin → Timetable → Period timings & rooms).</EmptyState>
      ) : (
        <Card
          title={base ? `Editing the version from ${formatDateKey(base.effectiveFrom)}` : "New timetable"}
          action={base && base.effectiveFrom < today ? <Badge tone="amber">Saving creates a new version</Badge> : undefined}
        >
          <TimetableEditor
            key={base?.id ?? "new"}
            sectionId={section.id}
            days={days}
            rows={gridRows(timings)}
            initialSlots={(base?.slots ?? []).map((s) => ({
              key: s.id,
              dayOfWeek: s.dayOfWeek,
              periodNumber: s.periodNumber,
              span: s.span,
              type: s.type,
              subjectId: s.subjectId,
              teacherId: s.teacherId,
              roomId: s.roomId,
              batchId: s.batchId,
            }))}
            subjects={subjects.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))}
            teachers={teacherOptions}
            rooms={rooms.map((r) => ({ value: r.id, label: `${r.name}${r.type === "LAB" ? " (lab)" : ""}` }))}
            batches={section.batches.map((b) => ({ value: b.id, label: b.name }))}
            defaultEffectiveFrom={base && base.effectiveFrom >= today ? base.effectiveFrom : today}
            minEffectiveFrom={today}
          />
        </Card>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title={`Changes for ${formatDateKey(changeDate)}`}>
          <form method="get" className="mb-4 flex gap-2">
            <input type="date" name="date" defaultValue={changeDate} min={today} className={inputClass} aria-label="Date" />
            <button className="rounded-md bg-slate-800 px-3 text-sm font-medium text-white">Show day</button>
          </form>
          {!day.working || day.reason ? (
            <EmptyState>{day.reason ?? "No classes that day."}</EmptyState>
          ) : (
            <DayList
              periods={day.periods}
              actions={(p) =>
                p.slotId && p.status === "SCHEDULED" ? (
                  <div className="flex flex-wrap items-center gap-1">
                    <ActionButton
                      action={markPeriodChange}
                      fields={{ sectionId: section.id, dateKey: changeDate, type: "CANCELLED", slotId: p.slotId }}
                      label="Cancel"
                      tone="danger"
                      confirmText="Cancel this period and notify students?"
                    />
                    <ActionForm action={markPeriodChange} submitLabel="Substitute" tone="secondary" className="flex items-center gap-1">
                      <input type="hidden" name="sectionId" value={section.id} />
                      <input type="hidden" name="dateKey" value={changeDate} />
                      <input type="hidden" name="type" value="SUBSTITUTED" />
                      <input type="hidden" name="slotId" value={p.slotId} />
                      <select name="substituteTeacherId" aria-label="Substitute teacher" className={`${inputClass} py-1 text-xs`}>
                        {teachers.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.user.name}
                          </option>
                        ))}
                      </select>
                    </ActionForm>
                  </div>
                ) : null
              }
            />
          )}
          <div className="mt-5 border-t border-slate-100 pt-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-800">Add an extra class</h3>
            <ActionForm action={markPeriodChange} submitLabel="Add extra class" resetOnSuccess>
              <input type="hidden" name="sectionId" value={section.id} />
              <input type="hidden" name="type" value="EXTRA" />
              <FieldGrid cols={3}>
                <Field label="Date" name="dateKey">
                  <Input name="dateKey" type="date" defaultValue={changeDate} min={today} />
                </Field>
                <Field label="Period" name="periodNumber">
                  <Select name="periodNumber" options={gridRows(timings).map((n) => ({ value: String(n), label: `P${n}` }))} />
                </Field>
                <Field label="Subject" name="subjectId">
                  <Select name="subjectId" options={subjects.map((s) => ({ value: s.id, label: s.code }))} />
                </Field>
              </FieldGrid>
              <Field label="Teacher" name="substituteTeacherId">
                <Select name="substituteTeacherId" options={teacherOptions} />
              </Field>
            </ActionForm>
          </div>
        </Card>

        <div className="space-y-6">
          <Card title="Upcoming changes">
            {changes.length === 0 ? (
              <EmptyState>No upcoming changes.</EmptyState>
            ) : (
              <Table head={["Date", "Period", "Change", ""]}>
                {changes.map((c) => (
                  <tr key={c.id}>
                    <td className={`${td} whitespace-nowrap text-xs`}>{formatDateKey(c.dateKey)}</td>
                    <td className={td}>P{c.periodNumber}</td>
                    <td className={`${td} text-xs`}>
                      <Badge tone={c.type === "CANCELLED" ? "red" : c.type === "EXTRA" ? "green" : "amber"}>{c.type}</Badge>{" "}
                      {c.substitute?.user.name} {c.subject?.code}
                    </td>
                    <td className={`${td} text-right`}>
                      <ActionButton action={removePeriodChange} fields={{ id: c.id }} label="Undo" tone="danger" />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card title="Versions">
            {versions.length === 0 ? (
              <EmptyState>No versions yet.</EmptyState>
            ) : (
              <Table head={["In force from", "Classes", "Note", "Status"]}>
                {versions.map((v) => (
                  <tr key={v.id}>
                    <td className={`${td} whitespace-nowrap`}>{formatDateKey(v.effectiveFrom)}</td>
                    <td className={`${td} tabular-nums`}>{v.slots.filter((s) => s.type !== "FREE").length}</td>
                    <td className={`${td} text-xs`}>{v.note ?? "–"}</td>
                    <td className={td}>
                      {v.id === current?.id ? (
                        <Badge tone="green">In force</Badge>
                      ) : v.effectiveFrom > today ? (
                        <Badge tone="brand">Upcoming</Badge>
                      ) : (
                        <Badge>Past</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
            <p className="mt-3 text-xs text-slate-500">
              Past attendance always follows the version that was in force that day (FR-64).
            </p>
          </Card>

          <Card title="Teacher workload (periods per week, all sections)">
            {usedTeacherIds.length === 0 ? (
              <EmptyState>No teachers assigned yet.</EmptyState>
            ) : (
              <ul className="space-y-1 text-sm">
                {usedTeacherIds.map((id) => {
                  const t = teachers.find((x) => x.id === id);
                  const n = workload.get(id) ?? 0;
                  return (
                    <li key={id} className="flex justify-between">
                      <span>{t?.user.name}</span>
                      <Badge tone={n > 24 ? "red" : n > 18 ? "amber" : "slate"}>{n} periods</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Import from CSV or Excel">
            <p className="mb-3 text-xs text-slate-600">
              Columns: <code>day, period, span, type, subject, teacher, room, batch</code>. Day is Mon-Sat, subject is the
              code, teacher is the college ID. The import replaces the grid for the chosen date, after a clash check.
            </p>
            <ActionForm action={importTimetable} submitLabel="Import" className="space-y-3">
              <input type="hidden" name="sectionId" value={section.id} />
              <FieldGrid>
                <Field label="In force from" name="effectiveFrom">
                  <Input name="effectiveFrom" type="date" defaultValue={today} min={today} />
                </Field>
                <Field label="File" name="file">
                  <input
                    id="file"
                    name="file"
                    type="file"
                    accept=".csv,.xlsx"
                    className="block w-full text-sm file:mr-2 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
                  />
                </Field>
              </FieldGrid>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
