import type { CurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { approvalScope } from "@/lib/approvers";
import { formatDateKey } from "@/lib/dates";
import { formatDateTime } from "@/lib/config";
import { decideLeave, decideRegularisation } from "@/app/approvals/actions";
import { Badge, Card, EmptyState, Table, td } from "./ui";
import { ActionForm, SubmitButton } from "./forms";
import { inputClass } from "./form-fields";

// Pending leave and regularisation requests for the students this user is
// responsible for (FR-11, FR-17). Used by the teacher and HOD portals.

const REASONS: Record<string, string> = {
  NETWORK: "Network failure",
  GPS: "GPS problem",
  DEVICE: "Phone problem",
  FORGOT: "Forgot to punch",
  OTHER: "Other",
};

function DecisionForm({ action, id }: { action: typeof decideLeave; id: string }) {
  return (
    <ActionForm action={action} submitLabel={null} className="flex min-w-56 flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <input name="note" placeholder="Note (required to reject)" className={`${inputClass} py-1 text-xs`} aria-label="Decision note" />
      <div className="flex gap-2">
        <SubmitButton size="sm" tone="success" name="decision" value="APPROVED" pendingLabel="…">
          Approve
        </SubmitButton>
        <SubmitButton size="sm" tone="danger" name="decision" value="REJECTED" pendingLabel="…">
          Reject
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export async function ApprovalsBoard({ user }: { user: CurrentUser }) {
  const scope = await approvalScope(user);
  if (!scope) {
    return <EmptyState>Requests are approved by class coordinators and HODs. You don&apos;t have either role.</EmptyState>;
  }
  const studentInclude = { student: { include: { user: { select: { name: true } }, section: true } } } as const;

  const [leaves, regs, decided] = await Promise.all([
    db.leaveRequest.findMany({ where: { status: "PENDING", student: scope }, orderBy: { createdAt: "asc" }, include: studentInclude }),
    db.regularisationRequest.findMany({
      where: { status: "PENDING", student: scope },
      orderBy: { createdAt: "asc" },
      include: { ...studentInclude, session: true },
    }),
    db.leaveRequest.findMany({
      where: { status: { in: ["APPROVED", "REJECTED"] }, student: scope },
      orderBy: { decidedAt: "desc" },
      take: 10,
      include: { ...studentInclude, decidedBy: { select: { name: true } } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <Card title={`Leave requests (${leaves.length} pending)`}>
        {leaves.length === 0 ? (
          <EmptyState>No pending leave requests.</EmptyState>
        ) : (
          <Table head={["Student", "Dates", "Type & reason", "Document", "Decision"]}>
            {leaves.map((l) => (
              <tr key={l.id}>
                <td className={td}>
                  <span className="font-medium">{l.student.user.name}</span>
                  <span className="block text-xs text-slate-500">
                    {l.student.rollNo} · Y{l.student.year}-{l.student.section.name}
                  </span>
                </td>
                <td className={`${td} whitespace-nowrap text-xs`}>
                  {formatDateKey(l.fromDate)}
                  {l.toDate !== l.fromDate && (
                    <>
                      <br />
                      to {formatDateKey(l.toDate)}
                    </>
                  )}
                </td>
                <td className={`${td} max-w-xs text-xs`}>
                  <Badge tone={l.type === "MEDICAL" ? "red" : "slate"}>{l.type}</Badge> {l.reason}
                  <span className="block text-slate-400">Sent {formatDateTime(l.createdAt)}</span>
                </td>
                <td className={td}>
                  {l.documentPath ? (
                    <a href={`/api/leave/${l.id}/document`} target="_blank" rel="noreferrer" className="text-xs text-brand-700 hover:underline">
                      Open
                    </a>
                  ) : (
                    "–"
                  )}
                </td>
                <td className={td}>
                  <DecisionForm action={decideLeave} id={l.id} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title={`Regularisation requests (${regs.length} pending)`}>
        {regs.length === 0 ? (
          <EmptyState>No pending regularisation requests.</EmptyState>
        ) : (
          <Table head={["Student", "Date", "Requested times", "Reason", "Decision"]}>
            {regs.map((r) => (
              <tr key={r.id}>
                <td className={td}>
                  <span className="font-medium">{r.student.user.name}</span>
                  <span className="block text-xs text-slate-500">
                    {r.student.rollNo} · Y{r.student.year}-{r.student.section.name}
                  </span>
                </td>
                <td className={`${td} whitespace-nowrap text-xs`}>
                  {formatDateKey(r.dateKey)}
                  <span className="block text-slate-500">{r.session ? `Recorded: ${r.session.status.toLowerCase()}` : "No punch recorded"}</span>
                </td>
                <td className={`${td} tabular-nums`}>
                  {r.requestedIn}–{r.requestedOut}
                </td>
                <td className={`${td} max-w-xs text-xs`}>
                  <Badge>{REASONS[r.reason]}</Badge> {r.details}
                </td>
                <td className={td}>
                  <DecisionForm action={decideRegularisation} id={r.id} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Recently decided leave">
        {decided.length === 0 ? (
          <EmptyState>Nothing decided yet.</EmptyState>
        ) : (
          <Table head={["Student", "Dates", "Decision", "By"]}>
            {decided.map((l) => (
              <tr key={l.id}>
                <td className={td}>{l.student.user.name}</td>
                <td className={`${td} text-xs`}>
                  {formatDateKey(l.fromDate)}
                  {l.toDate !== l.fromDate && <> – {formatDateKey(l.toDate)}</>}
                </td>
                <td className={td}>
                  <Badge tone={l.status === "APPROVED" ? "green" : "red"}>{l.status}</Badge>
                </td>
                <td className={`${td} text-xs`}>{l.decidedBy?.name}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
