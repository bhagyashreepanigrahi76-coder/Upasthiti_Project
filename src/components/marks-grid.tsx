"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "./forms";
import { saveMarks } from "@/app/marks-actions/actions";

// Grid marks entry for one assessment (FR-22): a number up to the maximum, or AB.

export type MarksRow = { id: string; name: string; rollNo: string; value: string };

function problem(value: string, max: number): string | null {
  const v = value.trim().toUpperCase();
  if (v === "" || v === "AB") return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(v)) return "Use a number or AB";
  if (Number(v) > max) return `Max ${max}`;
  return null;
}

export function MarksGrid({ mappingId, kind, maxMarks, rows }: { mappingId: string; kind: string; maxMarks: number; rows: MarksRow[] }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.id, r.value])));
  const filled = Object.values(values).filter((v) => v.trim() !== "").length;
  const invalid = rows.filter((r) => problem(values[r.id] ?? "", maxMarks)).length;

  return (
    <ActionForm action={saveMarks} submitLabel={null} className="space-y-4">
      <input type="hidden" name="mappingId" value={mappingId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="entries" value={JSON.stringify(values)} />
      <p className="text-sm text-slate-600">
        {filled} of {rows.length} entered · maximum {maxMarks} · type <strong>AB</strong> for absent
        {invalid > 0 && <span className="ml-2 font-medium text-red-700">{invalid} to fix</span>}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-3 font-medium">Roll no</th>
              <th className="py-2 pr-3 font-medium">Student</th>
              <th className="py-2 font-medium">Marks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const err = problem(values[r.id] ?? "", maxMarks);
              return (
                <tr key={r.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 pr-3 font-mono text-xs">{r.rollNo}</td>
                  <td className="py-1.5 pr-3">{r.name}</td>
                  <td className="py-1.5">
                    <input
                      aria-label={`Marks for ${r.name}`}
                      value={values[r.id] ?? ""}
                      onChange={(e) => setValues((all) => ({ ...all, [r.id]: e.target.value }))}
                      inputMode="decimal"
                      className={`w-24 rounded-md border px-2 py-1 text-right tabular-nums outline-none focus:ring-2 focus:ring-brand-100 ${
                        err ? "border-red-400 bg-red-50" : "border-slate-300"
                      }`}
                    />
                    {err && <span className="ml-2 text-xs text-red-600">{err}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <SubmitButton tone="secondary" name="intent" value="save">
          Save draft
        </SubmitButton>
        <SubmitButton tone="success" name="intent" value="submit" pendingLabel="Submitting…" confirmText="Submit these marks for HOD verification? You won't be able to change them afterwards.">
          Submit for verification
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
