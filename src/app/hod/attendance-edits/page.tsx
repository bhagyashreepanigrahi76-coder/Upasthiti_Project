import type { Metadata } from "next";
import { departmentsFor, requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateKey } from "@/lib/dates";
import { formatDateTime } from "@/lib/config";
import { Badge, Card, EmptyState, PageHeader, Table, td } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { inputClass } from "@/components/form-fields";
import { decideAttendanceEdit } from "@/app/attendance-actions/actions";

export const metadata: Metadata = { title: "Attendance edits" };

type Change = { studentId: string; from: string | null; to: string };
const LABEL: Record<string, string> = { PRESENT: "Present", ABSENT: "Absent", LATE: "Late", ON_LEAVE: "On leave", MEDICAL: "Medical" };

export default async function AttendanceEditsPage() {
  const user = await requirePortal("hod");
  const departments = departmentsFor(user, "HOD");
  const scope = { session: { section: { departmentId: { in: departments } } } };

  const [pending, decided] = await Promise.all([
    db.attendanceEditRequest.findMany({
      where: { status: "PENDING", ...scope },
      orderBy: { createdAt: "asc" },
      include: { session: { include: { section: { include: { department: true } }, subject: true } }, requestedBy: { select: { name: true } } },
    }),
    db.attendanceEditRequest.findMany({
      where: { status: { in: ["APPROVED", "REJECTED"] }, ...scope },
      orderBy: { decidedAt: "desc" },
      take: 10,
      include: { session: { include: { subject: true } }, requestedBy: { select: { name: true } }, decidedBy: { select: { name: true } } },
    }),
  ]);
  const studentIds = [...new Set(pending.flatMap((p) => (JSON.parse(p.changes) as Change[]).map((c) => c.studentId)))];
  const students = await db.student.findMany({ where: { id: { in: studentIds } }, include: { user: { select: { name: true } } } });
  const nameOf = (id: string) => students.find((s) => s.id === id)?.user.name ?? "Student";

  return (
    <>
      <PageHeader title="Attendance edits" subtitle="Changes requested after the edit window need your approval (FR-20)." />
      <Card title={`Waiting for you (${pending.length})`}>
        {pending.length === 0 ? (
          <EmptyState>No edit requests.</EmptyState>
        ) : (
          <div className="space-y-4">
            {pending.map((p) => (
              <div key={p.id} className="rounded-lg border border-slate-200 p-4">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">
                    {p.session.section.department.code} {p.session.section.year}-{p.session.section.name} · {p.session.subject?.code} ·{" "}
                    {formatDateKey(p.session.dateKey)}, period {p.session.periodNumber}
                  </p>
                  <p className="text-xs text-slate-500">
                    {p.requestedBy.name} · {formatDateTime(p.createdAt)}
                  </p>
                </div>
                <p className="mb-2 text-sm text-slate-700">“{p.reason}”</p>
                <ul className="mb-3 space-y-0.5 text-sm">
                  {(JSON.parse(p.changes) as Change[]).map((c) => (
                    <li key={c.studentId}>
                      {nameOf(c.studentId)}: <span className="text-slate-500">{c.from ? LABEL[c.from] : "not marked"}</span> →{" "}
                      <span className="font-medium">{LABEL[c.to]}</span>
                    </li>
                  ))}
                </ul>
                <ActionForm action={decideAttendanceEdit} submitLabel={null} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={p.id} />
                  <input name="note" placeholder="Note (required to reject)" className={`${inputClass} max-w-xs py-1 text-xs`} aria-label="Note" />
                  <SubmitButton size="sm" tone="success" name="decision" value="APPROVED" pendingLabel="…">
                    Approve
                  </SubmitButton>
                  <SubmitButton size="sm" tone="danger" name="decision" value="REJECTED" pendingLabel="…">
                    Reject
                  </SubmitButton>
                </ActionForm>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="Recently decided" className="mt-6">
        {decided.length === 0 ? (
          <EmptyState>Nothing yet.</EmptyState>
        ) : (
          <Table head={["Class", "Requested by", "Decision"]}>
            {decided.map((d) => (
              <tr key={d.id}>
                <td className={`${td} text-xs`}>
                  {formatDateKey(d.session.dateKey)} · P{d.session.periodNumber} · {d.session.subject?.code}
                </td>
                <td className={td}>{d.requestedBy.name}</td>
                <td className={td}>
                  <Badge tone={d.status === "APPROVED" ? "green" : "red"}>{d.status}</Badge>{" "}
                  <span className="text-xs text-slate-500">by {d.decidedBy?.name}</span>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
