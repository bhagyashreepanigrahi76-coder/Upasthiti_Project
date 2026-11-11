import type { Metadata } from "next";
import { requireStudent } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateKey, formatTime, toDateKey, addDays } from "@/lib/dates";
import { Badge, Card, EmptyState, PageHeader, Table, td } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/forms";
import { Field, FieldGrid, Input, Select, Textarea } from "@/components/form-fields";
import { cancelRequest, submitLeave, submitRegularisation } from "./actions";

export const metadata: Metadata = { title: "Leave & regularisation" };

const STATUS_TONES = { PENDING: "amber", APPROVED: "green", REJECTED: "red", CANCELLED: "slate" } as const;
const LEAVE_TYPES = [
  { value: "MEDICAL", label: "Medical" },
  { value: "PERSONAL", label: "Personal" },
  { value: "FAMILY", label: "Family" },
  { value: "OTHER", label: "Other" },
];
const REG_REASONS = [
  { value: "NETWORK", label: "No internet / network failure" },
  { value: "GPS", label: "GPS problem" },
  { value: "DEVICE", label: "Phone problem" },
  { value: "FORGOT", label: "Forgot to punch" },
  { value: "OTHER", label: "Other" },
];

export default async function StudentRequestsPage() {
  const { student } = await requireStudent();
  const today = toDateKey(new Date());

  const [leaves, regs, incomplete] = await Promise.all([
    db.leaveRequest.findMany({ where: { studentId: student.id }, orderBy: { createdAt: "desc" }, take: 20, include: { decidedBy: { select: { name: true } } } }),
    db.regularisationRequest.findMany({ where: { studentId: student.id }, orderBy: { createdAt: "desc" }, take: 20, include: { decidedBy: { select: { name: true } } } }),
    db.campusSession.findMany({
      where: { studentId: student.id, status: "INCOMPLETE", dateKey: { gte: addDays(today, -30) } },
      orderBy: { dateKey: "desc" },
    }),
  ]);

  return (
    <>
      <PageHeader title="Leave & regularisation" subtitle="Requests go to your class coordinator and HOD." />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Apply for leave">
          <ActionForm action={submitLeave} submitLabel="Send leave request" resetOnSuccess>
            <FieldGrid cols={3}>
              <Field label="From" name="fromDate">
                <Input name="fromDate" type="date" defaultValue={today} />
              </Field>
              <Field label="To" name="toDate">
                <Input name="toDate" type="date" defaultValue={today} />
              </Field>
              <Field label="Type" name="type">
                <Select name="type" options={LEAVE_TYPES} />
              </Field>
            </FieldGrid>
            <Field label="Reason" name="reason">
              <Textarea name="reason" />
            </Field>
            <Field label="Supporting document (optional)" name="document" hint="PDF, JPEG or PNG up to 5 MB. Needed for medical leave over 2 days.">
              <input
                id="document"
                name="document"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium"
              />
            </Field>
          </ActionForm>
        </Card>

        <Card title="Fix a missed or incomplete day">
          {incomplete.length > 0 && (
            <div className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
              <p className="font-medium">Incomplete days in the last 30 days:</p>
              <p>
                {incomplete.map((s) => `${formatDateKey(s.dateKey)} (in ${formatTime(s.inAt)})`).join(", ")}
              </p>
            </div>
          )}
          <ActionForm action={submitRegularisation} submitLabel="Send request" resetOnSuccess>
            <FieldGrid cols={3}>
              <Field label="Date" name="dateKey">
                <Input name="dateKey" type="date" defaultValue={incomplete[0]?.dateKey} max={today} />
              </Field>
              <Field label="Arrived at" name="requestedIn">
                <Input name="requestedIn" type="time" defaultValue="09:00" />
              </Field>
              <Field label="Left at" name="requestedOut">
                <Input name="requestedOut" type="time" defaultValue="16:30" />
              </Field>
            </FieldGrid>
            <Field label="What went wrong?" name="reason">
              <Select name="reason" options={REG_REASONS} />
            </Field>
            <Field label="Details" name="details">
              <Textarea name="details" placeholder="e.g. GPS showed 300 m accuracy inside the library." />
            </Field>
          </ActionForm>
        </Card>
      </div>

      <Card title="My leave requests" className="mt-6">
        {leaves.length === 0 ? (
          <EmptyState>No leave requests yet.</EmptyState>
        ) : (
          <Table head={["Dates", "Type", "Reason", "Document", "Status", ""]}>
            {leaves.map((l) => (
              <tr key={l.id}>
                <td className={`${td} whitespace-nowrap text-xs`}>
                  {formatDateKey(l.fromDate)}
                  {l.toDate !== l.fromDate && <> – {formatDateKey(l.toDate)}</>}
                </td>
                <td className={td}>{l.type.charAt(0) + l.type.slice(1).toLowerCase()}</td>
                <td className={`${td} max-w-xs text-xs`}>{l.reason}</td>
                <td className={td}>
                  {l.documentPath ? (
                    <a href={`/api/leave/${l.id}/document`} target="_blank" rel="noreferrer" className="text-xs text-brand-700 hover:underline">
                      View
                    </a>
                  ) : (
                    "–"
                  )}
                </td>
                <td className={td}>
                  <Badge tone={STATUS_TONES[l.status]}>{l.status}</Badge>
                  {l.decidedBy && <span className="block text-xs text-slate-500">by {l.decidedBy.name}</span>}
                  {l.decisionNote && <span className="block text-xs text-slate-500">“{l.decisionNote}”</span>}
                </td>
                <td className={`${td} text-right`}>
                  {l.status === "PENDING" && <ActionButton action={cancelRequest} fields={{ id: l.id, kind: "leave" }} label="Cancel" tone="danger" />}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="My regularisation requests" className="mt-6">
        {regs.length === 0 ? (
          <EmptyState>No regularisation requests yet.</EmptyState>
        ) : (
          <Table head={["Date", "Times", "Reason", "Status", ""]}>
            {regs.map((r) => (
              <tr key={r.id}>
                <td className={`${td} whitespace-nowrap text-xs`}>{formatDateKey(r.dateKey)}</td>
                <td className={`${td} tabular-nums`}>
                  {r.requestedIn}–{r.requestedOut}
                </td>
                <td className={`${td} max-w-xs text-xs`}>
                  {REG_REASONS.find((x) => x.value === r.reason)?.label} · {r.details}
                </td>
                <td className={td}>
                  <Badge tone={STATUS_TONES[r.status]}>{r.status}</Badge>
                  {r.decidedBy && <span className="block text-xs text-slate-500">by {r.decidedBy.name}</span>}
                  {r.decisionNote && <span className="block text-xs text-slate-500">“{r.decisionNote}”</span>}
                </td>
                <td className={`${td} text-right`}>
                  {r.status === "PENDING" && <ActionButton action={cancelRequest} fields={{ id: r.id, kind: "reg" }} label="Cancel" tone="danger" />}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
