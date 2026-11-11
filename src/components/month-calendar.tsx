import Link from "next/link";
import type { CalendarEvent } from "@prisma/client";
import type { AppSettings } from "@/lib/settings";
import { dayStatusFrom } from "@/lib/calendar";
import { WEEKDAY_SHORT, formatMonthKey, monthWeeks, shiftMonth } from "@/lib/dates";

// Read-only month grid shared by every portal's calendar page (FR-16).

const TYPE_STYLE: Record<CalendarEvent["type"], string> = {
  HOLIDAY: "bg-red-50 text-red-700",
  EXAM: "bg-violet-50 text-violet-700",
  WORKING_SATURDAY: "bg-emerald-50 text-emerald-700",
  EVENT: "bg-sky-50 text-sky-700",
};
export const TYPE_LABEL: Record<CalendarEvent["type"], string> = {
  HOLIDAY: "Holiday",
  EXAM: "Exam",
  WORKING_SATURDAY: "Working Saturday",
  EVENT: "Event",
};

export function MonthCalendar({
  monthKey,
  events,
  settings,
  today,
  basePath,
}: {
  monthKey: string;
  events: CalendarEvent[];
  settings: AppSettings;
  today: string;
  basePath: string;
}) {
  const weeks = monthWeeks(monthKey);
  const sep = basePath.includes("?") ? "&" : "?";

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Link href={`${basePath}${sep}month=${shiftMonth(monthKey, -1)}`} className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50">
          ← Previous
        </Link>
        <h2 className="text-base font-semibold text-slate-900">{formatMonthKey(monthKey)}</h2>
        <Link href={`${basePath}${sep}month=${shiftMonth(monthKey, 1)}`} className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50">
          Next →
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
          <thead>
            <tr>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <th key={d} className="py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  {WEEKDAY_SHORT[d]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, wi) => (
              <tr key={wi}>
                {week.map((day, di) => {
                  if (!day) return <td key={di} className="h-24 border border-slate-100 bg-slate-50/50" />;
                  const status = dayStatusFrom(day, events, settings);
                  return (
                    <td
                      key={day}
                      className={`h-24 border border-slate-100 p-1.5 align-top ${status.working ? "bg-white" : "bg-slate-50"} ${
                        day === today ? "ring-2 ring-inset ring-brand-600" : ""
                      }`}
                    >
                      <span className={`text-xs font-medium ${status.working ? "text-slate-800" : "text-slate-400"}`}>
                        {Number(day.slice(8))}
                      </span>
                      <ul className="mt-1 space-y-0.5">
                        {status.events.map((e) => (
                          <li key={e.id} title={e.description ?? e.title} className={`truncate rounded px-1 py-0.5 text-[11px] ${TYPE_STYLE[e.type]}`}>
                            {e.title}
                          </li>
                        ))}
                      </ul>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        {(Object.keys(TYPE_STYLE) as CalendarEvent["type"][]).map((t) => (
          <span key={t} className={`rounded px-2 py-0.5 ${TYPE_STYLE[t]}`}>
            {TYPE_LABEL[t]}
          </span>
        ))}
        <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-500">Grey = not a working day</span>
      </div>
    </div>
  );
}
