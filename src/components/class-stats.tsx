import { classStats } from "@/lib/results";
import { StatCard } from "./ui";

/** FR-25: average, highest, lowest, pass percentage and at-risk students. */
export function ClassStats({
  entries,
  maxMarks,
  passPercent,
}: {
  entries: { marks: number | null; absent: boolean; name: string; rollNo: string }[];
  maxMarks: number;
  passPercent: number;
}) {
  const s = classStats(entries, maxMarks, passPercent);
  const atRisk = entries.filter((e) => e.absent || (e.marks !== null && e.marks < s.passMark));
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Average" value={s.average ?? "–"} hint={`out of ${maxMarks}`} />
        <StatCard label="Highest" value={s.highest ?? "–"} />
        <StatCard label="Lowest" value={s.lowest ?? "–"} />
        <StatCard label="Pass rate" value={s.passPercent === null ? "–" : `${s.passPercent}%`} hint={`pass mark ${s.passMark}`} />
        <StatCard label="Absent" value={s.absent} />
      </div>
      {atRisk.length > 0 && (
        <p className="mt-3 text-sm text-slate-700">
          <span className="font-medium text-red-700">At risk ({atRisk.length}):</span>{" "}
          {atRisk.map((e) => `${e.name} (${e.absent ? "AB" : e.marks})`).join(", ")}
        </p>
      )}
    </div>
  );
}
