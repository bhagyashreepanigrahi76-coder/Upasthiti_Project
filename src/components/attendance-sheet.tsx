"use client";

import { useState } from "react";
import { ActionForm } from "./forms";
import { Field, Input } from "./form-fields";
import { saveAttendance } from "@/app/attendance-actions/actions";

// Period attendance sheet (FR-61). One tap per student.

type Status = "PRESENT" | "LATE" | "ABSENT" | "ON_LEAVE" | "MEDICAL";
export type SheetRow = {
  id: string;
  name: string;
  rollNo: string;
  status: Status;
  hasCampusDay: boolean;
  onApprovedLeave: boolean;
};

const OPTIONS: { value: Status; short: string; label: string; on: string }[] = [
  { value: "PRESENT", short: "P", label: "Present", on: "bg-emerald-600 text-white border-emerald-600" },
  { value: "LATE", short: "L", label: "Late", on: "bg-amber-500 text-white border-amber-500" },
  { value: "ABSENT", short: "A", label: "Absent", on: "bg-red-600 text-white border-red-600" },
  { value: "ON_LEAVE", short: "Lv", label: "On leave", on: "bg-sky-600 text-white border-sky-600" },
  { value: "MEDICAL", short: "M", label: "Medical", on: "bg-violet-600 text-white border-violet-600" },
];

export function AttendanceSheet({
  dateKey,
  periodKey,
  rows,
  needsReason,
  requireCampusPunch,
}: {
  dateKey: string;
  periodKey: string;
  rows: SheetRow[];
  needsReason: boolean;
  requireCampusPunch: boolean;
}) {
  const [statuses, setStatuses] = useState<Record<string, Status>>(() => Object.fromEntries(rows.map((r) => [r.id, r.status])));
  const set = (id: string, s: Status) => setStatuses((all) => ({ ...all, [id]: s }));
  const count = (s: Status) => Object.values(statuses).filter((x) => x === s).length;

  return (
    <ActionForm action={saveAttendance} submitLabel={needsReason ? "Send change for HOD approval" : "Save attendance"} className="space-y-4">
      <input type="hidden" name="dateKey" value={dateKey} />
      <input type="hidden" name="periodKey" value={periodKey} />
      <input type="hidden" name="entries" value={JSON.stringify(statuses)} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {OPTIONS.map((o) => `${o.label} ${count(o.value)}`).join(" · ")}
        </p>
        <button
          type="button"
          onClick={() => setStatuses(Object.fromEntries(rows.map((r) => [r.id, r.onApprovedLeave ? "ON_LEAVE" : "PRESENT"])))}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Mark everyone present
        </button>
      </div>

      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">{r.name}</p>
              <p className="text-xs text-slate-500">
                <span className="font-mono">{r.rollNo}</span>
                {r.onApprovedLeave && <span className="ml-2 text-sky-700">Approved leave</span>}
                {requireCampusPunch && !r.hasCampusDay && !r.onApprovedLeave && (
                  <span className="ml-2 text-amber-700" title="Present counts only after a campus punch or approved regularisation">
                    No campus punch
                  </span>
                )}
              </p>
            </div>
            <div className="flex gap-1" role="radiogroup" aria-label={`Attendance for ${r.name}`}>
              {OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={statuses[r.id] === o.value}
                  title={o.label}
                  onClick={() => set(r.id, o.value)}
                  className={`h-8 min-w-9 rounded-md border px-2 text-xs font-semibold ${
                    statuses[r.id] === o.value ? o.on : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {o.short}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {needsReason && (
        <Field label="Reason for the change" name="reason" hint="Edits after the edit window need the HOD's approval (FR-20).">
          <Input name="reason" placeholder="e.g. Student was in the lab, marked absent by mistake" />
        </Field>
      )}
    </ActionForm>
  );
}
