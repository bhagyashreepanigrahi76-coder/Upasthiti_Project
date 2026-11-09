import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { WEEKDAY_SHORT } from "@/lib/dates";
import { Badge, Card, EmptyState, PageHeader, Table, td } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/forms";
import { Checkbox, Field, FieldGrid, Input, Select } from "@/components/form-fields";
import { deleteGeofence, saveGeofence, savePunchSettings, toggleGeofence } from "./actions";
import { UseLocationButton } from "./use-location-button";

export const metadata: Metadata = { title: "Geofence & hours" };

type Props = { searchParams: Promise<{ edit?: string }> };

export default async function GeofencePage({ searchParams }: Props) {
  await requireRole("ADMIN");
  const { edit } = await searchParams;
  const [fences, settings] = await Promise.all([
    db.geofence.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { punches: true } } } }),
    getSettings(),
  ]);
  const editing = fences.find((f) => f.id === edit);

  return (
    <>
      <PageHeader title="Geofence & college hours" subtitle="Where and when students can punch in and out." />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Campus points">
          {fences.length === 0 ? (
            <EmptyState>No campus point yet. Students cannot punch until you add one.</EmptyState>
          ) : (
            <Table head={["Name", "Location", "Radius", "Status", ""]}>
              {fences.map((f) => (
                <tr key={f.id}>
                  <td className={`${td} font-medium`}>{f.name}</td>
                  <td className={`${td} font-mono text-xs`}>
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${f.latitude}&mlon=${f.longitude}#map=18/${f.latitude}/${f.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-700 hover:underline"
                    >
                      {f.latitude.toFixed(5)}, {f.longitude.toFixed(5)}
                    </a>
                  </td>
                  <td className={`${td} tabular-nums`}>{f.radiusMeters} m</td>
                  <td className={td}>
                    <Badge tone={f.isActive ? "green" : "slate"}>{f.isActive ? "Active" : "Off"}</Badge>
                  </td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    <Link href={`/admin/geofence?edit=${f.id}`} className="mr-2 text-xs font-medium text-brand-700 hover:underline">
                      Edit
                    </Link>
                    <ActionButton action={toggleGeofence} fields={{ id: f.id }} label={f.isActive ? "Turn off" : "Turn on"} />{" "}
                    <ActionButton action={deleteGeofence} fields={{ id: f.id }} label="Delete" tone="danger" confirmText={`Delete ${f.name}?`} />
                  </td>
                </tr>
              ))}
            </Table>
          )}

          <div className="mt-5 border-t border-slate-100 pt-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-800">{editing ? `Edit ${editing.name}` : "Add campus point"}</h3>
            <ActionForm key={editing?.id ?? "new"} action={saveGeofence} submitLabel={editing ? "Save" : "Add point"} resetOnSuccess={!editing}>
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <FieldGrid>
                <Field label="Name" name="name">
                  <Input name="name" defaultValue={editing?.name} placeholder="Main campus" />
                </Field>
                <Field label="Radius (metres)" name="radiusMeters" hint="PRD default is 100 m.">
                  <Input name="radiusMeters" type="number" min={20} max={2000} defaultValue={editing?.radiusMeters ?? 100} />
                </Field>
                <Field label="Latitude" name="latitude">
                  <Input name="latitude" inputMode="decimal" defaultValue={editing?.latitude} placeholder="12.971599" />
                </Field>
                <Field label="Longitude" name="longitude">
                  <Input name="longitude" inputMode="decimal" defaultValue={editing?.longitude} placeholder="77.594566" />
                </Field>
              </FieldGrid>
              <UseLocationButton />
            </ActionForm>
            <p className="mt-3 text-xs text-slate-500">
              Add several points for separate buildings or a second campus. A punch counts if it is inside any active point.
            </p>
          </div>
        </Card>

        <Card title="Punch rules, hours and thresholds">
          <ActionForm action={savePunchSettings} submitLabel="Save settings">
            <FieldGrid cols={3}>
              <Field label="College starts" name="collegeStart">
                <Input name="collegeStart" type="time" defaultValue={settings.collegeStart} />
              </Field>
              <Field label="College ends" name="collegeEnd">
                <Input name="collegeEnd" type="time" defaultValue={settings.collegeEnd} />
              </Field>
              <Field label="Punch cut-off" name="punchCutoff" hint="Open sessions close as incomplete after this.">
                <Input name="punchCutoff" type="time" defaultValue={settings.punchCutoff} />
              </Field>
            </FieldGrid>
            <Field label="Allow punch-in this many minutes before start" name="earlyArrivalMinutes">
              <Input name="earlyArrivalMinutes" type="number" min={0} max={180} defaultValue={settings.earlyArrivalMinutes} />
            </Field>
            <Field label="Regular working days" name="workingDays" hint="Saturdays can also be marked working one at a time in the calendar.">
              <div className="flex flex-wrap gap-3">
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <label key={d} className="inline-flex items-center gap-1.5 text-sm">
                    <input type="checkbox" name="workingDays" value={d} defaultChecked={settings.workingDays.includes(d)} className="h-4 w-4" />
                    {WEEKDAY_SHORT[d]}
                  </label>
                ))}
              </div>
            </Field>
            <div className="flex flex-col gap-2 rounded-lg bg-slate-50 p-3">
              <Checkbox name="enforceSchedule" label="Only allow punches on working days and within college hours" defaultChecked={settings.enforceSchedule} />
              <Checkbox name="requireDeviceBinding" label="Bind each student to one approved phone" defaultChecked={settings.requireDeviceBinding} />
              <Checkbox name="allowMultipleSessions" label="Allow more than one campus session per day" defaultChecked={settings.allowMultipleSessions} />
            </div>
            <FieldGrid>
              <Field label="Required GPS accuracy (m)" name="maxAccuracyMeters">
                <Input name="maxAccuracyMeters" type="number" defaultValue={settings.maxAccuracyMeters} />
              </Field>
              <Field label="Boundary tolerance (m)" name="toleranceMeters" hint="Extra metres allowed beyond each radius.">
                <Input name="toleranceMeters" type="number" defaultValue={settings.toleranceMeters} />
              </Field>
              <Field label="Allowed clock difference (min)" name="maxClockSkewMinutes">
                <Input name="maxClockSkewMinutes" type="number" defaultValue={settings.maxClockSkewMinutes} />
              </Field>
              <Field label="Offline sync limit (hours)" name="offlineSyncLimitHours" hint="Later syncs are flagged for review.">
                <Input name="offlineSyncLimitHours" type="number" defaultValue={settings.offlineSyncLimitHours} />
              </Field>
              <Field label="Impossible speed (km/h)" name="maxSpeedKmh">
                <Input name="maxSpeedKmh" type="number" defaultValue={settings.maxSpeedKmh} />
              </Field>
            </FieldGrid>
            <h3 className="pt-2 text-sm font-semibold text-slate-800">Attendance thresholds</h3>
            <FieldGrid cols={3}>
              <Field label="Warning below (%)" name="warningThreshold">
                <Input name="warningThreshold" type="number" defaultValue={settings.warningThreshold} />
              </Field>
              <Field label="Critical alert below (%)" name="criticalThreshold">
                <Input name="criticalThreshold" type="number" defaultValue={settings.criticalThreshold} />
              </Field>
              <Field label="Approved leave" name="leavePolicy">
                <Select
                  name="leavePolicy"
                  defaultValue={settings.leavePolicy}
                  options={[
                    { value: "EXCLUDE_FROM_DENOMINATOR", label: "Not counted (excluded)" },
                    { value: "COUNT_AS_PRESENT", label: "Counted as present" },
                  ]}
                />
              </Field>
            </FieldGrid>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
