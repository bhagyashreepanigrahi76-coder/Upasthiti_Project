"use client";

import { useMemo, useState } from "react";
import { ActionForm } from "./forms";
import { Field, Input, inputClass, type Option } from "./form-fields";
import { saveTimetable } from "@/app/timetable-actions/actions";

// Weekly grid editor for one section (FR-57). Slots are edited in the browser
// and saved together; the server checks clashes before anything is stored.

type SlotType = "LECTURE" | "PRACTICAL" | "TUTORIAL" | "FREE";
export type EditorSlot = {
  key: string;
  dayOfWeek: number;
  periodNumber: number;
  span: number;
  type: SlotType;
  subjectId: string | null;
  teacherId: string | null;
  roomId: string | null;
  batchId: string | null;
};
export type EditorDay = { dow: number; label: string; periods: { number: number; time: string }[] };

const TYPES: { value: SlotType; label: string }[] = [
  { value: "LECTURE", label: "Lecture" },
  { value: "PRACTICAL", label: "Practical" },
  { value: "TUTORIAL", label: "Tutorial" },
  { value: "FREE", label: "Free" },
];

let counter = 0;
const newKey = () => `new-${++counter}`;

export function TimetableEditor({
  sectionId,
  days,
  rows,
  initialSlots,
  subjects,
  teachers,
  rooms,
  batches,
  defaultEffectiveFrom,
  minEffectiveFrom,
}: {
  sectionId: string;
  days: EditorDay[];
  rows: number[];
  initialSlots: EditorSlot[];
  subjects: Option[];
  teachers: Option[];
  rooms: Option[];
  batches: Option[];
  defaultEffectiveFrom: string;
  minEffectiveFrom: string;
}) {
  const [slots, setSlots] = useState<EditorSlot[]>(initialSlots);
  const [cell, setCell] = useState<{ dow: number; period: number } | null>(null);
  const label = (opts: Option[], id: string | null) => opts.find((o) => o.value === id)?.label ?? "";

  const covered = useMemo(() => {
    // Cells covered by a multi-period slot that starts earlier.
    const set = new Set<string>();
    for (const s of slots) for (let p = s.periodNumber + 1; p < s.periodNumber + s.span; p++) set.add(`${s.dayOfWeek}:${p}`);
    return set;
  }, [slots]);

  const update = (key: string, patch: Partial<EditorSlot>) => setSlots((all) => all.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const remove = (key: string) => setSlots((all) => all.filter((s) => s.key !== key));
  const add = (dow: number, period: number) =>
    setSlots((all) => [
      ...all,
      { key: newKey(), dayOfWeek: dow, periodNumber: period, span: 1, type: "LECTURE", subjectId: null, teacherId: null, roomId: null, batchId: null },
    ]);

  const cellSlots = cell ? slots.filter((s) => s.dayOfWeek === cell.dow && s.periodNumber === cell.period) : [];
  const payload = JSON.stringify(
    slots.map(({ dayOfWeek, periodNumber, span, type, subjectId, teacherId, roomId, batchId }) => ({
      dayOfWeek, periodNumber, span, type, subjectId, teacherId, roomId, batchId,
    })),
  );
  const shortSubject = (id: string | null) => label(subjects, id).split(" · ")[0];

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] table-fixed border-collapse text-xs">
          <thead>
            <tr>
              <th className="w-16 py-2 text-left font-medium text-slate-500">Period</th>
              {days.map((d) => (
                <th key={d.dow} className="py-2 font-medium text-slate-600">
                  {d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p}>
                <td className="border border-slate-100 p-1 align-top font-medium text-slate-500">P{p}</td>
                {days.map((d) => {
                  const period = d.periods.find((x) => x.number === p);
                  if (!period) return <td key={d.dow} className="border border-slate-100 bg-slate-50" />;
                  const here = slots.filter((s) => s.dayOfWeek === d.dow && s.periodNumber === p);
                  const isCovered = covered.has(`${d.dow}:${p}`);
                  const active = cell?.dow === d.dow && cell.period === p;
                  return (
                    <td key={d.dow} className={`border border-slate-100 p-1 align-top ${active ? "bg-brand-50" : ""}`}>
                      <button type="button" onClick={() => setCell({ dow: d.dow, period: p })} className="block w-full min-h-14 rounded text-left hover:bg-slate-50">
                        <span className="block text-[10px] text-slate-400">{period.time}</span>
                        {isCovered && here.length === 0 && <span className="text-slate-400">↑ continues</span>}
                        {here.map((s) => (
                          <span
                            key={s.key}
                            className={`mb-0.5 block truncate rounded px-1 py-0.5 ${
                              s.type === "PRACTICAL" ? "bg-amber-50 text-amber-800" : s.type === "FREE" ? "bg-slate-100 text-slate-500" : "bg-brand-50 text-brand-700"
                            }`}
                          >
                            {s.type === "FREE" ? "Free" : shortSubject(s.subjectId) || "?"}
                            {s.batchId && ` · ${label(batches, s.batchId)}`}
                            {s.span > 1 && ` (${s.span}p)`}
                          </span>
                        ))}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cell && (
        <div className="mt-4 rounded-lg border border-brand-100 bg-brand-50/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">
              {days.find((d) => d.dow === cell.dow)?.label}, period {cell.period}
            </h3>
            <button type="button" onClick={() => setCell(null)} className="text-xs text-slate-500 hover:underline">
              Close
            </button>
          </div>
          {cellSlots.length === 0 && <p className="mb-3 text-sm text-slate-600">Nothing scheduled.</p>}
          <div className="space-y-3">
            {cellSlots.map((s) => (
              <div key={s.key} className="grid gap-2 rounded-md bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-7">
                <select aria-label="Type" className={inputClass} value={s.type} onChange={(e) => update(s.key, { type: e.target.value as SlotType })}>
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <select aria-label="Subject" className={`${inputClass} lg:col-span-2`} value={s.subjectId ?? ""} onChange={(e) => update(s.key, { subjectId: e.target.value || null })}>
                  <option value="">Subject…</option>
                  {subjects.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select aria-label="Teacher" className={inputClass} value={s.teacherId ?? ""} onChange={(e) => update(s.key, { teacherId: e.target.value || null })}>
                  <option value="">Teacher…</option>
                  {teachers.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select aria-label="Room" className={inputClass} value={s.roomId ?? ""} onChange={(e) => update(s.key, { roomId: e.target.value || null })}>
                  <option value="">Room…</option>
                  {rooms.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select aria-label="Batch" className={inputClass} value={s.batchId ?? ""} onChange={(e) => update(s.key, { batchId: e.target.value || null })}>
                  <option value="">Whole section</option>
                  {batches.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <select aria-label="Length" className={inputClass} value={s.span} onChange={(e) => update(s.key, { span: Number(e.target.value) })}>
                    {[1, 2, 3].map((n) => (
                      <option key={n} value={n}>
                        {n} period{n > 1 ? "s" : ""}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => remove(s.key)} className="text-xs font-medium text-red-700 hover:underline">
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => add(cell.dow, cell.period)}
            className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {cellSlots.length ? "Add a parallel batch slot" : "Add a class here"}
          </button>
        </div>
      )}

      <div className="mt-5 border-t border-slate-100 pt-4">
        <ActionForm action={saveTimetable} submitLabel="Save timetable" pendingLabel="Checking clashes…" className="space-y-3">
          <input type="hidden" name="sectionId" value={sectionId} />
          <input type="hidden" name="slots" value={payload} />
          <div className="flex flex-wrap items-start gap-3">
            <Field label="In force from" name="effectiveFrom" hint="Same date as the current version updates it; a later date creates a new version.">
              <Input name="effectiveFrom" type="date" defaultValue={defaultEffectiveFrom} min={minEffectiveFrom} />
            </Field>
            <Field label="Note (optional)" name="note" className="min-w-56 flex-1">
              <Input name="note" placeholder="e.g. Lab moved to Thursday" />
            </Field>
          </div>
        </ActionForm>
      </div>
    </div>
  );
}
