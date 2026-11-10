import Link from "next/link";
import type { CurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { CATEGORY_LABEL, postRights, readStats } from "@/lib/notices";
import { addDays, toDateKey } from "@/lib/dates";
import { formatDateTime } from "@/lib/config";
import { decideNotice, saveNotice, saveNoticeSettings, withdrawNotice } from "@/app/notice-actions/actions";
import { Badge, Card, EmptyState, PageHeader, Table, td } from "./ui";
import { ActionButton, ActionForm, SubmitButton } from "./forms";
import { Checkbox, Field, FieldGrid, Input, Select, Textarea } from "./form-fields";

// Post and manage notices (FR-43..53). Admin: whole college, approvals and
// settings. HOD: own department. Teachers: own classes, if the admin allows.

const STATUS_TONE = { PUBLISHED: "green", PENDING_APPROVAL: "amber", REJECTED: "red", WITHDRAWN: "slate" } as const;

export async function NoticeManager({ user, basePath, editId }: { user: CurrentUser; basePath: string; editId?: string }) {
  const rights = await postRights(user);
  const settings = await getSettings();
  if (!rights) {
    return (
      <>
        <PageHeader title="Notices" />
        <EmptyState>Posting notices is turned off for teachers. Ask the admin or your HOD to post it.</EmptyState>
      </>
    );
  }
  const isAdmin = rights.level === "admin";
  const today = toDateKey(new Date());
  const ay = await db.academicYear.findFirst({ where: { isCurrent: true } });

  const [mine, pending, editing, departments, sections, subjects, events] = await Promise.all([
    db.notice.findMany({
      where: isAdmin ? {} : { createdById: user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { createdBy: { select: { name: true } }, _count: { select: { reads: true } } },
    }),
    isAdmin ? db.notice.findMany({ where: { status: "PENDING_APPROVAL" }, orderBy: { createdAt: "asc" }, include: { createdBy: { select: { name: true } } } }) : [],
    editId ? db.notice.findUnique({ where: { id: editId } }) : null,
    db.department.findMany({ where: rights.level === "admin" ? {} : { id: { in: rights.departments } }, orderBy: { code: "asc" } }),
    db.section.findMany({
      where: {
        academicYearId: ay?.id,
        ...(rights.level === "hod" ? { departmentId: { in: rights.departments } } : rights.level === "teacher" ? { id: { in: rights.sectionIds } } : {}),
      },
      include: { department: true },
      orderBy: [{ department: { code: "asc" } }, { year: "asc" }, { name: "asc" }],
    }),
    db.subject.findMany({
      where: rights.level === "hod" ? { departmentId: { in: rights.departments } } : rights.level === "teacher" ? { id: { in: rights.subjectIds } } : {},
      orderBy: { code: "asc" },
    }),
    db.calendarEvent.findMany({ where: { endDate: { gte: today } }, orderBy: { startDate: "asc" }, take: 30 }),
  ]);
  const editable = editing && (editing.createdById === user.id || isAdmin) && editing.status !== "WITHDRAWN" ? editing : null;
  const urgentStats = new Map(await Promise.all(mine.filter((n) => n.urgent && n.status === "PUBLISHED").map(async (n) => [n.id, await readStats(n)] as const)));
  const pubDate = editable ? toDateKey(editable.publishAt) : "";
  const expDate = editable?.expiresAt ? addDays(toDateKey(editable.expiresAt), -1) : "";

  return (
    <>
      <PageHeader
        title="Notices"
        subtitle={
          rights.level === "admin"
            ? "Post once; everyone in the audience sees it on the notice board and in the app."
            : rights.level === "hod"
              ? `You post for your department${settings.noticeApprovalRequired ? "; the admin approves before it goes out" : ""}.`
              : `You post to your own classes${settings.noticeApprovalRequired ? "; the admin approves before it goes out" : ""}.`
        }
      >
        <Link href="/notices" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          View notice board
        </Link>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card title={editable ? "Edit notice" : "New notice"} className="xl:col-span-3">
          <ActionForm key={editable?.id ?? "new"} action={saveNotice} submitLabel={editable ? "Save changes" : "Publish"} resetOnSuccess={!editable}>
            {editable && <input type="hidden" name="id" value={editable.id} />}
            <Field label="Title" name="title">
              <Input name="title" defaultValue={editable?.title} placeholder="Internal Assessment 1 timetable" />
            </Field>
            <Field label="Message" name="body">
              <Textarea name="body" rows={5} defaultValue={editable?.body} />
            </Field>
            <FieldGrid cols={3}>
              <Field label="Category" name="category">
                <Select name="category" defaultValue={editable?.category ?? "GENERAL"} options={Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))} />
              </Field>
              <Field label="Audience" name="audience">
                <Select
                  name="audience"
                  defaultValue={editable?.audience ?? (rights.level === "teacher" ? "STUDENTS" : "EVERYONE")}
                  options={(rights.level === "teacher" ? ["STUDENTS", "PARENTS"] : ["EVERYONE", "STUDENTS", "TEACHERS", "PARENTS"]).map((a) => ({
                    value: a,
                    label: { EVERYONE: "Everyone", STUDENTS: "Students only", TEACHERS: "Teachers only", PARENTS: "Parents only" }[a]!,
                  }))}
                />
              </Field>
              <Field label="Year" name="year">
                <Select name="year" defaultValue={editable?.year ? String(editable.year) : ""} placeholder="All years" options={[1, 2, 3].map((y) => ({ value: String(y), label: `Year ${y}` }))} />
              </Field>
              {rights.level !== "teacher" && (
                <Field label="Department" name="departmentId">
                  <Select name="departmentId" defaultValue={editable?.departmentId ?? ""} placeholder={rights.level === "admin" ? "All departments" : undefined} options={departments.map((d) => ({ value: d.id, label: d.code }))} />
                </Field>
              )}
              <Field label="Section" name="sectionId">
                <Select name="sectionId" defaultValue={editable?.sectionId ?? ""} placeholder="Any section" options={sections.map((s) => ({ value: s.id, label: `${s.department.code} ${s.year}-${s.name}` }))} />
              </Field>
              <Field label="Subject" name="subjectId">
                <Select name="subjectId" defaultValue={editable?.subjectId ?? ""} placeholder="Any subject" options={subjects.map((s) => ({ value: s.id, label: s.code }))} />
              </Field>
            </FieldGrid>
            <FieldGrid cols={3}>
              <Field label="Publish on" name="publishDate" hint="Empty = now">
                <Input name="publishDate" type="date" defaultValue={pubDate} />
              </Field>
              <Field label="At" name="publishTime">
                <Input name="publishTime" type="time" defaultValue="09:00" />
              </Field>
              <Field label="Expires after" name="expiresOn" hint="Then it moves to the archive">
                <Input name="expiresOn" type="date" defaultValue={expDate} />
              </Field>
            </FieldGrid>
            <FieldGrid>
              <Field label="Link to calendar entry" name="calendarEventId">
                <Select name="calendarEventId" defaultValue={editable?.calendarEventId ?? ""} placeholder="None" options={events.map((e) => ({ value: e.id, label: `${e.startDate} · ${e.title}` }))} />
              </Field>
              <Field label="Attachment" name="attachment" hint={`PDF, image or Word, up to ${settings.uploadMaxMb} MB${editable?.attachmentName ? `. Current: ${editable.attachmentName}` : ""}`}>
                <input id="attachment" name="attachment" type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" className="block w-full text-sm file:mr-2 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm" />
              </Field>
            </FieldGrid>
            <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg bg-slate-50 p-3">
              <Checkbox name="urgent" label="Urgent (red banner)" defaultChecked={editable?.urgent} />
              {rights.level !== "teacher" && <Checkbox name="pinned" label="Pin to top" defaultChecked={editable?.pinned} />}
              <Checkbox name="notifyOnPublish" label="Notify in the app" defaultChecked={editable?.notifyOnPublish ?? true} />
              <Checkbox name="emailOnPublish" label="Also email" defaultChecked={editable?.emailOnPublish} />
              {isAdmin && <Checkbox name="isPublic" label="Show on the public notice board" defaultChecked={editable?.isPublic} />}
              {editable?.attachmentName && <Checkbox name="removeAttachment" label="Remove attachment" />}
            </div>
          </ActionForm>
          {editable && (
            <Link href={basePath} className="mt-2 inline-block text-xs text-slate-500 hover:underline">
              Cancel editing
            </Link>
          )}
        </Card>

        <div className="space-y-6 xl:col-span-2">
          {isAdmin && (
            <Card title={`Waiting for approval (${pending.length})`}>
              {pending.length === 0 ? (
                <EmptyState>Nothing to approve.</EmptyState>
              ) : (
                <ul className="space-y-3">
                  {pending.map((n) => (
                    <li key={n.id} className="rounded-md border border-slate-200 p-3">
                      <Link href={`/notices/${n.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                        {n.title}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {n.createdBy.name} · {formatDateTime(n.createdAt)}
                      </p>
                      <ActionForm action={decideNotice} submitLabel={null} className="mt-2 flex gap-2">
                        <input type="hidden" name="id" value={n.id} />
                        <SubmitButton size="sm" tone="success" name="decision" value="APPROVED">
                          Approve
                        </SubmitButton>
                        <SubmitButton size="sm" tone="danger" name="decision" value="REJECTED">
                          Reject
                        </SubmitButton>
                      </ActionForm>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {isAdmin && (
            <Card title="Who can post">
              <ActionForm action={saveNoticeSettings} submitLabel="Save" tone="secondary">
                <div className="flex flex-col gap-2">
                  <Checkbox name="teachersCanPostNotices" label="Teachers can post to their own classes" defaultChecked={settings.teachersCanPostNotices} />
                  <Checkbox name="noticeApprovalRequired" label="HOD and teacher notices need admin approval" defaultChecked={settings.noticeApprovalRequired} />
                </div>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>

      <Card title={isAdmin ? "All notices" : "My notices"} className="mt-6">
        {mine.length === 0 ? (
          <EmptyState>No notices yet.</EmptyState>
        ) : (
          <Table head={["Notice", "Status", "Publish", "Reads", ""]}>
            {mine.map((n) => {
              const s = urgentStats.get(n.id);
              return (
                <tr key={n.id}>
                  <td className={td}>
                    <Link href={`/notices/${n.id}`} className="font-medium text-brand-700 hover:underline">
                      {n.title}
                    </Link>
                    <span className="block text-xs text-slate-500">
                      {CATEGORY_LABEL[n.category]} · {n.createdBy.name}
                      {n.urgent && " · urgent"}
                      {n.editedAt && " · updated"}
                    </span>
                  </td>
                  <td className={td}>
                    <Badge tone={STATUS_TONE[n.status]}>{n.status.replace("_", " ").toLowerCase()}</Badge>
                  </td>
                  <td className={`${td} whitespace-nowrap text-xs`}>{formatDateTime(n.publishAt)}</td>
                  <td className={`${td} text-xs tabular-nums`}>{s ? `${s.read}/${s.audience}` : n._count.reads}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    {n.status !== "WITHDRAWN" && (
                      <>
                        <Link href={`${basePath}?edit=${n.id}`} className="mr-2 text-xs font-medium text-brand-700 hover:underline">
                          Edit
                        </Link>
                        <ActionButton action={withdrawNotice} fields={{ id: n.id }} label="Withdraw" tone="danger" confirmText="Withdraw this notice?" />
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}
