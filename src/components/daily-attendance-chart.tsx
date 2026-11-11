import type { DayPoint } from "@/lib/analytics";
import { formatDateKey } from "@/lib/dates";

// Day-wise class attendance (FR-29). One series, one hue, so no legend: the
// card title names it. Thin bars rounded at the data end, 2px gaps, recessive
// grid, a labelled requirement line, a native tooltip on every bar, and a
// table for screen readers.

const W = 720;
const H = 220;
const PAD = { top: 12, right: 40, bottom: 28, left: 34 };
const BAR = "#7a1f2b"; // sindoori maroon (Sambalpuri theme)

export function DailyAttendanceChart({ data, target }: { data: DayPoint[]; target: number }) {
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / data.length;
  const barW = Math.max(2, slot - 2); // 2px surface gap between bars
  const y = (p: number) => PAD.top + plotH - (p / 100) * plotH;
  const withData = data.filter((d) => d.percent !== null);
  const avg = withData.length ? Math.round((withData.reduce((s, d) => s + d.percent!, 0) / withData.length) * 10) / 10 : null;

  return (
    <figure>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[560px]"
          role="img"
          aria-label={`Daily class attendance for the last ${data.length} days. Average ${avg ?? "not available"} percent; requirement ${target} percent.`}
        >
          {[0, 25, 50, 75, 100].map((g) => (
            <g key={g}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(g)} y2={y(g)} stroke="#e2e8f0" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(g) + 3} textAnchor="end" fontSize={10} fill="#64748b">
                {g}%
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = PAD.left + i * slot + 1;
            if (d.percent === null) return null;
            const top = y(d.percent);
            const h = Math.max(1, PAD.top + plotH - top);
            const r = Math.min(4, barW / 2, h);
            // Rounded at the data end only; square on the baseline.
            const path = `M${x},${PAD.top + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${PAD.top + plotH} Z`;
            return (
              <g key={d.dateKey}>
                <path d={path} fill={BAR} />
                {/* Hit target taller than the bar, for the tooltip */}
                <rect x={x - 1} y={PAD.top} width={slot} height={plotH} fill="transparent">
                  <title>{`${formatDateKey(d.dateKey)}: ${d.percent}% (${d.attended} of ${d.held} class attendances) · ${d.onCampus} students on campus`}</title>
                </rect>
              </g>
            );
          })}
          <line x1={PAD.left} x2={W - PAD.right} y1={y(target)} y2={y(target)} stroke="#334155" strokeWidth={1} strokeDasharray="4 3" />
          <text x={W - PAD.right + 4} y={y(target) + 3} fontSize={10} fill="#334155">
            {target}%
          </text>
          {data.map((d, i) =>
            i % 5 === 0 || i === data.length - 1 ? (
              <text key={d.dateKey} x={PAD.left + i * slot + slot / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="#64748b">
                {Number(d.dateKey.slice(8))}/{Number(d.dateKey.slice(5, 7))}
              </text>
            ) : null,
          )}
        </svg>
      </div>
      <figcaption className="mt-1 text-xs text-slate-500">
        Average {avg === null ? "–" : `${avg}%`} on days with classes. Dashed line: the {target}% requirement. Hover a bar for details.
      </figcaption>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-slate-600">Show as a table</summary>
        <table className="mt-2 w-full">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 font-medium">Date</th>
              <th className="py-1 font-medium">Attendance</th>
              <th className="py-1 font-medium">On campus</th>
            </tr>
          </thead>
          <tbody>
            {data
              .filter((d) => d.held > 0 || d.onCampus > 0)
              .map((d) => (
                <tr key={d.dateKey}>
                  <td className="py-0.5">{formatDateKey(d.dateKey)}</td>
                  <td className="py-0.5 tabular-nums">{d.percent === null ? "–" : `${d.percent}% (${d.attended}/${d.held})`}</td>
                  <td className="py-0.5 tabular-nums">{d.onCampus}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
