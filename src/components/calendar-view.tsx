import { eventsInRange, type CalendarScope } from "@/lib/calendar";
import { getSettings } from "@/lib/settings";
import { addDays, formatDateKey, isMonthKey, toDateKey } from "@/lib/dates";
import { Badge, Card, EmptyState } from "./ui";
import { MonthCalendar, TYPE_LABEL } from "./month-calendar";

// Calendar page body used by the student, teacher and parent portals.
// The caller has already checked the role and decides the scope.
export async function CalendarView({
  scope,
  month,
  basePath,
}: {
  scope?: CalendarScope;
  month?: string;
  basePath: string;
}) {
  const today = toDateKey(new Date());
  const monthKey = isMonthKey(month) ? month : today.slice(0, 7);
  const [settings, monthEvents, upcoming] = await Promise.all([
    getSettings(),
    eventsInRange(`${monthKey}-01`, `${monthKey}-31`, scope),
    eventsInRange(today, addDays(today, 60), scope),
  ]);

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <MonthCalendar monthKey={monthKey} events={monthEvents} settings={settings} today={today} basePath={basePath} />
      </Card>
      <Card title="Coming up (next 60 days)" className="h-fit">
        {upcoming.length === 0 ? (
          <EmptyState>Nothing scheduled.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {upcoming.map((e) => (
              <li key={e.id} className="text-sm">
                <p className="font-medium text-slate-900">{e.title}</p>
                <p className="text-xs text-slate-500">
                  {e.startDate === e.endDate ? formatDateKey(e.startDate) : `${formatDateKey(e.startDate)} – ${formatDateKey(e.endDate)}`}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge tone={e.type === "HOLIDAY" ? "red" : e.type === "EXAM" ? "brand" : e.type === "WORKING_SATURDAY" ? "green" : "slate"}>
                    {TYPE_LABEL[e.type]}
                  </Badge>
                  {(e.department || e.year) && (
                    <Badge>{[e.department?.code, e.year ? `Year ${e.year}` : null].filter(Boolean).join(" · ")}</Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
