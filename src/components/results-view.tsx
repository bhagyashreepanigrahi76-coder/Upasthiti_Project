import { studentResults } from "@/lib/results";
import { Badge, Card, EmptyState, StatCard } from "./ui";

// Published results for one student (FR-33). The caller checks access.
// Only assessments whose publish time has passed are included (FR-24).

export async function ResultsView({ studentId, semester }: { studentId: string; semester?: number }) {
  const { semesters, cgpa, settings } = await studentResults(studentId);
  const shown = semester ? semesters.filter((s) => s.semester === semester) : semesters;
  if (semesters.length === 0) return <EmptyState>No results have been published yet.</EmptyState>;

  return (
    <div className="space-y-6">
      {settings.showGpa && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="CGPA" value={cgpa ?? "–"} hint="All semesters with final results" />
          {semesters.map((s) => (
            <StatCard key={s.semester} label={`SGPA · Semester ${s.semester}`} value={s.sgpa ?? "–"} hint={s.sgpa === null ? "Semester exam not published" : `${s.credits} credits`} />
          ))}
        </div>
      )}
      {shown.map((sem) => (
        <Card key={sem.semester} title={`Semester ${sem.semester}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3 font-medium">Subject</th>
                  <th className="py-2 pr-3 font-medium">Marks</th>
                  <th className="py-2 pr-3 font-medium">Total</th>
                  <th className="py-2 pr-3 font-medium">Grade</th>
                  <th className="py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {sem.subjects.map((r) => (
                  <tr key={r.subjectId} className="border-b border-slate-100 align-top last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-mono text-xs text-slate-500">{r.code}</span> {r.name}
                      <span className="block text-xs text-slate-500">{r.credits} credits</span>
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {r.components.map((c) => (
                        <span key={c.kind} className="block">
                          {c.label}: <span className="font-medium tabular-nums">{c.absent ? "AB" : c.marks}</span>/{c.maxMarks}
                        </span>
                      ))}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {r.percent === null ? "–" : `${r.percent}%`}
                      {!r.final && <span className="block text-xs text-slate-500">so far</span>}
                    </td>
                    <td className="py-2 pr-3 font-semibold">{r.grade ?? "–"}</td>
                    <td className="py-2">
                      {r.passed === null ? <Badge>Pending</Badge> : r.passed ? <Badge tone="green">Pass</Badge> : <Badge tone="red">Fail</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
      <p className="text-xs text-slate-500">
        Grades are given once the semester exam is published. Pass mark: {settings.passPercent}% of the subject total.
      </p>
    </div>
  );
}
