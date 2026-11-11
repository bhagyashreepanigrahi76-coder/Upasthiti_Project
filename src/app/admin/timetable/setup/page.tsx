import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { getTimings } from "@/lib/timetable";
import { Badge, Card, EmptyState, PageHeader, Table, td } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/forms";
import { Checkbox, Field, FieldGrid, Input, Select } from "@/components/form-fields";
import { addPeriodTiming, deletePeriodTiming, deleteRoom, saveRoom } from "@/app/timetable-actions/actions";

export const metadata: Metadata = { title: "Period timings & rooms" };

export default async function TimetableSetupPage() {
  await requireRole("ADMIN");
  const [timings, rooms] = await Promise.all([
    getTimings(),
    db.room.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { slots: true } } } }),
  ]);

  return (
    <>
      <PageHeader
        title="Period timings & rooms"
        subtitle={
          <Link href="/admin/timetable" className="text-brand-700 hover:underline">
            Back to timetables
          </Link>
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        {(["WEEKDAY", "SATURDAY"] as const).map((dayType) => (
          <Card key={dayType} title={dayType === "WEEKDAY" ? "Monday – Friday" : "Saturday"}>
            {timings[dayType].length === 0 ? (
              <EmptyState>{dayType === "SATURDAY" ? "No Saturday periods. Add them if Saturdays have classes." : "No periods yet."}</EmptyState>
            ) : (
              <Table head={["", "Time", ""]}>
                {timings[dayType].map((t) => (
                  <tr key={t.id}>
                    <td className={td}>{t.periodNumber ? <Badge tone="brand">P{t.periodNumber}</Badge> : <Badge>{t.label ?? "Break"}</Badge>}</td>
                    <td className={`${td} tabular-nums`}>
                      {t.startTime}–{t.endTime}
                    </td>
                    <td className={`${td} text-right`}>
                      <ActionButton action={deletePeriodTiming} fields={{ id: t.id }} label="Remove" tone="danger" />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        ))}

        <Card title="Add a period or break">
          <ActionForm action={addPeriodTiming} submitLabel="Add" resetOnSuccess>
            <Field label="Day type" name="dayType">
              <Select
                name="dayType"
                options={[
                  { value: "WEEKDAY", label: "Monday – Friday" },
                  { value: "SATURDAY", label: "Saturday" },
                ]}
              />
            </Field>
            <FieldGrid>
              <Field label="Starts" name="startTime">
                <Input name="startTime" type="time" />
              </Field>
              <Field label="Ends" name="endTime">
                <Input name="endTime" type="time" />
              </Field>
            </FieldGrid>
            <Checkbox name="isBreak" label="This is a break (no classes)" />
            <Field label="Break name" name="label">
              <Input name="label" placeholder="Lunch" />
            </Field>
          </ActionForm>
        </Card>
      </div>

      <Card title="Rooms and labs" className="mt-6">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {rooms.length === 0 ? (
              <EmptyState>No rooms yet.</EmptyState>
            ) : (
              <Table head={["Room", "Type", "Capacity", "Used in", ""]}>
                {rooms.map((r) => (
                  <tr key={r.id}>
                    <td className={`${td} font-medium`}>{r.name}</td>
                    <td className={td}>{r.type.charAt(0) + r.type.slice(1).toLowerCase()}</td>
                    <td className={`${td} tabular-nums`}>{r.capacity ?? "–"}</td>
                    <td className={`${td} tabular-nums`}>{r._count.slots} slots</td>
                    <td className={`${td} text-right`}>
                      <ActionButton action={deleteRoom} fields={{ id: r.id }} label="Delete" tone="danger" />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
          <ActionForm action={saveRoom} submitLabel="Add room" resetOnSuccess>
            <Field label="Name" name="name">
              <Input name="name" placeholder="CR-105" />
            </Field>
            <FieldGrid>
              <Field label="Type" name="type">
                <Select
                  name="type"
                  options={[
                    { value: "CLASSROOM", label: "Classroom" },
                    { value: "LAB", label: "Lab" },
                    { value: "HALL", label: "Hall" },
                  ]}
                />
              </Field>
              <Field label="Capacity" name="capacity">
                <Input name="capacity" type="number" min={1} />
              </Field>
            </FieldGrid>
          </ActionForm>
        </div>
      </Card>
    </>
  );
}
