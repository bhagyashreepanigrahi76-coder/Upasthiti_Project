import { notFound } from "next/navigation";
import { departmentsFor, type CurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { KIND_LABEL, STATUS_LABEL, isVisible, showMark } from "@/lib/results";
import { formatDateTime } from "@/lib/config";
import { toDateKey } from "@/lib/dates";
import { manageResult, reviseMark, verifyMarks } from "@/app/marks-actions/actions";
import { Badge, Card, EmptyState, PageHeader, Table, td } from "./ui";
import { ActionForm } from "./forms";
import { Field, FieldGrid, Input, Select } from "./form-fields";
import { ClassStats } from "./class-stats";

// Review of one assessment for the HOD (verify / return) and admin
// (lock, schedule, publish, unpublish), with logged revisions (FR-23, FR-24).

export async function AssessmentReview({ user, assessmentId, backHref }: { user: CurrentUser; assessmentId: string; backHref: string }) {
  const a = await db.assessment.findUnique({
    where: { id: assessmentId },
    include: {
      subject: true,
      section: { include: { department: true } },
      marks: true,
      revisions: { orderBy: { createdAt: "desc" }, include: { student: { include: { user: { select: { name: true } } } } } },
    },
  });
  if (!a) notFound();
  const isAdmin = user.roles.includes("ADMIN");
  const isHod = departmentsFor(user, "HOD").includes(a.section.departmentId);
  if (!isAdmin && !isHod) notFound();

  const [settings, roster] = await Promise.all([
    getSettings(),
    db.student.findMany({ where: { sectionId: a.sectionId, status: "ACTIVE" }, orderBy: { rollNo: "asc" }, include: { user: { select: { name: true } } } }),
  ]);
  const people = await db.user.findMany({
    where: { id: { in: [a.submittedById, a.verifiedById, a.lockedById, ...a.revisions.map((r) => r.revisedById)].filter((x): x is string => !!x) } },
    select: { id: true, name: true },
  });
  const who = (id: string | null) => people.find((p) => p.id === id)?.name ?? "–";
  const entry = (sid: string) => a.marks.find((m) => m.studentId === sid);
  const visible = isVisible(a);
  const scheduled = a.status === "LOCKED" && a.publishAt && !visible;

  return (
    <>
      <PageHeader
        title={`${a.subject.code} · ${KIND_LABEL[a.kind]}`}
        subtitle={
          <>
            {a.subject.name} · {a.section.department.code} Year {a.section.year}-{a.section.name} · max {a.maxMarks}, weight {a.weightage}% ·{" "}
            <a href={backHref} className="text-brand-700 hover:underline">
              Back
            </a>{" "}
            ·{" "}
            <a href={`/api/exports/marks/${a.id}?format=xlsx`} className="text-brand-700 hover:underline">
              Download Excel
            </a>
          </>
        }
      >
        <div className="flex gap-1">
          <Badge tone={a.status === "PUBLISHED" ? "green" : a.status === "DRAFT" ? "amber" : "brand"}>{STATUS_LABEL[a.status]}</Badge>
          {scheduled && <Badge tone="amber">Publishes {formatDateTime(a.publishAt!)}</Badge>}
          {visible && <Badge tone="green">Visible to students</Badge>}
        </div>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Class analytics">
            <ClassStats
              maxMarks={a.maxMarks}
              passPercent={settings.passPercent}
              entries={a.marks.map((m) => {
                const s = roster.find((r) => r.id === m.studentId);
                return { marks: m.marks, absent: m.absent, name: s?.user.name ?? "?", rollNo: s?.rollNo ?? "" };
              })}
            />
          </Card>
          <Card title="Marks">
            <Table head={["Roll no", "Student", "Marks", "%"]}>
              {roster.map((s) => {
                const e = entry(s.id);
                return (
                  <tr key={s.id}>
                    <td className={`${td} font-mono text-xs`}>{s.rollNo}</td>
                    <td className={td}>{s.user.name}</td>
                    <td className={`${td} tabular-nums`}>{showMark(e) || <span className="text-slate-400">missing</span>}</td>
                    <td className={`${td} tabular-nums text-slate-500`}>{e && !e.absent && e.marks !== null ? `${Math.round((e.marks / a.maxMarks) * 100)}%` : ""}</td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Workflow">
            <ol className="mb-4 space-y-1 text-sm text-slate-700">
              <li>Submitted: {a.submittedAt ? `${who(a.submittedById)}, ${formatDateTime(a.submittedAt)}` : "–"}</li>
              <li>Verified: {a.verifiedAt ? `${who(a.verifiedById)}, ${formatDateTime(a.verifiedAt)}` : "–"}</li>
              <li>Locked: {a.lockedAt ? `${who(a.lockedById)}, ${formatDateTime(a.lockedAt)}` : "–"}</li>
              <li>Published: {a.publishedAt ? formatDateTime(a.publishedAt) : scheduled ? `scheduled for ${formatDateTime(a.publishAt!)}` : "–"}</li>
            </ol>

            {a.status === "SUBMITTED" && (
              <ActionForm action={verifyMarks} submitLabel={null} className="space-y-2">
                <input type="hidden" name="id" value={a.id} />
                <Field label="Note to the teacher (needed to send back)" name="note">
                  <Input name="note" />
                </Field>
                <div className="flex gap-2">
                  <button name="intent" value="verify" className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
                    Verify
                  </button>
                  <button name="intent" value="return" className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50">
                    Send back
                  </button>
                </div>
              </ActionForm>
            )}

            {isAdmin && a.status === "VERIFIED" && (
              <ActionForm action={manageResult} submitLabel="Lock marks" className="space-y-2">
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="intent" value="lock" />
              </ActionForm>
            )}

            {isAdmin && a.status === "LOCKED" && (
              <div className="space-y-4">
                <ActionForm action={manageResult} submitLabel={a.publishAt ? "Change schedule" : "Schedule"} tone="secondary" className="space-y-2">
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="intent" value="schedule" />
                  <FieldGrid>
                    <Field label="Publish on" name="date">
                      <Input name="date" type="date" min={toDateKey(new Date())} />
                    </Field>
                    <Field label="At" name="time">
                      <Input name="time" type="time" defaultValue="10:00" />
                    </Field>
                  </FieldGrid>
                </ActionForm>
                <ActionForm action={manageResult} submitLabel="Publish now" tone="success" confirmText="Publish now and notify students and parents?" className="space-y-2">
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="intent" value="publish" />
                </ActionForm>
              </div>
            )}

            {isAdmin && (a.status === "PUBLISHED" || scheduled) && (
              <ActionForm action={manageResult} submitLabel={a.status === "PUBLISHED" ? "Unpublish" : "Cancel schedule"} tone="danger" confirmText="Hide this result from students?" className="mt-3 space-y-2">
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="intent" value="unpublish" />
              </ActionForm>
            )}
            {!isAdmin && (a.status === "VERIFIED" || a.status === "LOCKED") && <p className="text-xs text-slate-500">The admin locks and publishes verified marks.</p>}
          </Card>

          {(a.status === "LOCKED" || a.status === "PUBLISHED") && (
            <Card title="Revise a locked mark">
              <ActionForm action={reviseMark} submitLabel="Save revision" resetOnSuccess>
                <input type="hidden" name="id" value={a.id} />
                <Field label="Student" name="studentId">
                  <Select name="studentId" options={roster.map((s) => ({ value: s.id, label: `${s.rollNo} · ${s.user.name} (${showMark(entry(s.id)) || "–"})` }))} />
                </Field>
                <Field label="Corrected mark" name="value">
                  <Input name="value" placeholder={`0-${a.maxMarks} or AB`} />
                </Field>
                <Field label="Reason" name="reason">
                  <Input name="reason" placeholder="e.g. Re-totalling after revaluation" />
                </Field>
              </ActionForm>
            </Card>
          )}

          <Card title="Revision history">
            {a.revisions.length === 0 ? (
              <EmptyState>No revisions.</EmptyState>
            ) : (
              <ul className="space-y-2 text-sm">
                {a.revisions.map((r) => (
                  <li key={r.id}>
                    <span className="font-medium">{r.student.user.name}</span>: {r.oldAbsent ? "AB" : (r.oldMarks ?? "–")} → {r.newAbsent ? "AB" : r.newMarks}
                    <span className="block text-xs text-slate-500">
                      {who(r.revisedById)}, {formatDateTime(r.createdAt)} · “{r.reason}”
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
