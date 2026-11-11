import type { ScheduledPeriod, SlotWithDetails, Timings } from "@/lib/timetable";
import { slotTime, teachingPeriods } from "@/lib/timetable";
import { WEEKDAY_SHORT, parseHHMM } from "@/lib/dates";
import { Badge, EmptyState } from "./ui";

// Read-only timetable displays (FR-59, FR-60, FR-65).

export type GridSlot = SlotWithDetails & { sectionLabel?: string };

/** Days shown in a grid: Mon-Fri, plus Saturday when Saturday timings exist. */
export function gridDays(timings: Timings): number[] {
  return timings.SATURDAY.some((t) => t.periodNumber != null) ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
}

export function gridRows(timings: Timings): number[] {
  const nums = new Set<number>();
  for (const dow of [1, 6]) for (const p of teachingPeriods(timings, dow)) nums.add(p.periodNumber!);
  return [...nums].sort((a, b) => a - b);
}

export function WeekGrid({
  timings,
  slots,
  todayDow,
  show = "teacher",
}: {
  timings: Timings;
  slots: GridSlot[];
  todayDow?: number;
  /** What the second line shows: the teacher (student view) or the section (teacher view). */
  show?: "teacher" | "section";
}) {
  const days = gridDays(timings);
  const rows = gridRows(timings);
  if (rows.length === 0) return <EmptyState>Period timings have not been set up yet.</EmptyState>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] table-fixed border-collapse text-xs print:min-w-0">
        <thead>
          <tr>
            <th className="w-14 py-2 text-left font-medium text-slate-500">Period</th>
            {days.map((d) => (
              <th key={d} className={`py-2 font-medium ${d === todayDow ? "text-brand-700" : "text-slate-600"}`}>
                {WEEKDAY_SHORT[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p}>
              <td className="border border-slate-200 p-1 align-top font-medium text-slate-500">P{p}</td>
              {days.map((d) => {
                const exists = teachingPeriods(timings, d).some((x) => x.periodNumber === p);
                if (!exists) return <td key={d} className="border border-slate-200 bg-slate-50" />;
                const here = slots.filter((s) => s.dayOfWeek === d && s.periodNumber === p && s.type !== "FREE");
                const continuing = slots.some((s) => s.dayOfWeek === d && s.periodNumber < p && s.periodNumber + s.span > p);
                const time = slotTime(timings, d, p, 1);
                return (
                  <td key={d} className={`border border-slate-200 p-1 align-top ${d === todayDow ? "bg-brand-50/40" : ""}`}>
                    <span className="block text-[10px] text-slate-400">
                      {time.start}–{time.end}
                    </span>
                    {continuing && here.length === 0 && <span className="text-slate-400">↑</span>}
                    {here.map((s) => (
                      <div
                        key={s.id}
                        className={`mb-0.5 rounded px-1 py-0.5 ${s.type === "PRACTICAL" ? "bg-amber-50 text-amber-900" : "bg-slate-100 text-slate-800"}`}
                      >
                        <span className="block font-medium">
                          {s.subject?.code ?? s.type}
                          {s.span > 1 && <span className="font-normal"> ({s.span}p)</span>}
                        </span>
                        <span className="block truncate text-[11px] text-slate-600">
                          {show === "section" ? s.sectionLabel : s.teacher?.user.name}
                          {s.batch && ` · ${s.batch.name}`}
                        </span>
                        {s.room && <span className="block text-[10px] text-slate-500">{s.room.name}</span>}
                      </div>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS_BADGE = {
  SCHEDULED: null,
  CANCELLED: <Badge tone="red">Cancelled</Badge>,
  SUBSTITUTED: <Badge tone="amber">Substitute</Badge>,
  EXTRA: <Badge tone="green">Extra class</Badge>,
} as const;

/** A day's periods; marks the current and next period when nowMinutes is given (FR-60). */
export function DayList({
  periods,
  nowMinutes,
  show = "teacher",
  actions,
}: {
  periods: ScheduledPeriod[];
  nowMinutes?: number;
  show?: "teacher" | "section";
  actions?: (p: ScheduledPeriod) => React.ReactNode;
}) {
  if (periods.length === 0) return <EmptyState>No classes.</EmptyState>;
  const live = periods.filter((p) => p.status !== "CANCELLED");
  const current = nowMinutes != null ? live.find((p) => parseHHMM(p.start) <= nowMinutes && nowMinutes < parseHHMM(p.end)) : undefined;
  const next = nowMinutes != null ? live.find((p) => parseHHMM(p.start) > nowMinutes) : undefined;

  return (
    <ul className="divide-y divide-slate-100">
      {periods.map((p) => (
        <li
          key={p.key}
          className={`flex flex-wrap items-center justify-between gap-3 py-2.5 ${p === current ? "-mx-2 rounded-md bg-brand-50 px-2" : ""} ${
            p.status === "CANCELLED" ? "opacity-60" : ""
          }`}
        >
          <div className="flex items-start gap-3">
            <span className="w-24 shrink-0 text-xs tabular-nums text-slate-500">
              P{p.periodNumber}
              {p.span > 1 && `-${p.periodNumber + p.span - 1}`} · {p.start}
            </span>
            <div>
              <p className={`text-sm font-medium text-slate-900 ${p.status === "CANCELLED" ? "line-through" : ""}`}>{p.subject}</p>
              <p className="text-xs text-slate-500">
                {[show === "section" ? p.sectionLabel : p.teacherName, p.roomName, p.batchName].filter(Boolean).join(" · ")}
              </p>
              {p.note && <p className="text-xs text-slate-500">{p.note}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {p === current && <Badge tone="brand">Now</Badge>}
            {p === next && <Badge>Next</Badge>}
            {STATUS_BADGE[p.status]}
            {actions?.(p)}
          </div>
        </li>
      ))}
    </ul>
  );
}
