import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/roles";
import { formatDateTime } from "@/lib/config";
import { Badge, Card, EmptyState, PageHeader, Table, td } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/forms";
import { Field, FieldGrid, Input, Select } from "@/components/form-fields";
import {
  addRole,
  removeRole,
  resetUserPassword,
  setUserActive,
  unlockUser,
  updateProfile,
  updateStudentPlacement,
  updateTeacher,
} from "../actions";
import { approveDevice, rejectDevice } from "../../devices/actions";

export const metadata: Metadata = { title: "User details" };

type Props = { params: Promise<{ id: string }> };

const DEVICE_TONES = { PENDING: "amber", APPROVED: "green", REJECTED: "red", REVOKED: "slate" } as const;

export default async function UserDetailPage({ params }: Props) {
  const admin = await requireRole("ADMIN");
  const { id } = await params;

  const user = await db.user.findUnique({
    where: { id },
    include: {
      roles: { include: { department: true, section: true }, orderBy: { createdAt: "asc" } },
      student: {
        include: {
          department: true,
          section: true,
          batch: true,
          mentor: { include: { user: true } },
          parents: { include: { parent: true } },
        },
      },
      teacher: { include: { department: true, _count: { select: { subjects: true, mentees: true } } } },
      parent: { include: { students: { include: { student: { include: { user: true, section: true } } } } } },
      devices: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!user) notFound();

  const currentYear = await db.academicYear.findFirst({ where: { isCurrent: true } });
  const [departments, sections, teachers, activity] = await Promise.all([
    db.department.findMany({ orderBy: { code: "asc" } }),
    db.section.findMany({
      where: { academicYearId: currentYear?.id },
      orderBy: [{ department: { code: "asc" } }, { year: "asc" }, { name: "asc" }],
      include: { department: true, batches: { orderBy: { name: "asc" } } },
    }),
    db.teacher.findMany({ include: { user: true }, orderBy: { user: { name: "asc" } } }),
    db.auditLog.findMany({
      where: { OR: [{ actorId: user.id }, { entityId: user.id }] },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { actor: { select: { name: true } } },
    }),
  ]);
  const sectionOptions = sections.map((s) => ({ value: s.id, label: `${s.department.code} · Year ${s.year} · ${s.name}` }));
  const locked = user.lockedUntil && user.lockedUntil > new Date();
  const isSelf = user.id === admin.id;

  return (
    <>
      <PageHeader
        title={user.name}
        subtitle={
          <>
            <span className="font-mono">{user.collegeId}</span> ·{" "}
            <Link href="/admin/users" className="text-brand-700 hover:underline">
              All users
            </Link>
          </>
        }
      >
        <div className="flex flex-wrap gap-1">
          {!user.isActive && <Badge tone="red">Inactive</Badge>}
          {user.mustChangePassword && <Badge tone="amber">Not activated yet</Badge>}
          {locked && <Badge tone="red">Locked</Badge>}
        </div>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Profile">
          <ActionForm action={updateProfile} submitLabel="Save profile">
            <input type="hidden" name="id" value={user.id} />
            <Field label="Full name" name="name">
              <Input name="name" defaultValue={user.name} />
            </Field>
            <FieldGrid>
              <Field label="Email" name="email">
                <Input name="email" type="email" defaultValue={user.email ?? ""} />
              </Field>
              <Field label="Phone" name="phone">
                <Input name="phone" type="tel" defaultValue={user.phone ?? ""} />
              </Field>
            </FieldGrid>
          </ActionForm>
        </Card>

        <Card title="Account">
          <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Last sign-in</dt>
              <dd>{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Created</dt>
              <dd>{formatDateTime(user.createdAt)}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <ActionForm
              action={resetUserPassword}
              submitLabel="Reset password"
              tone="secondary"
              className="w-full space-y-2"
              confirmText="Reset this user's password and sign them out everywhere?"
            >
              <input type="hidden" name="id" value={user.id} />
            </ActionForm>
            {locked && <ActionButton action={unlockUser} fields={{ id: user.id }} label="Unlock" />}
            {!isSelf && (
              <ActionButton
                action={setUserActive}
                fields={{ id: user.id, active: String(!user.isActive) }}
                label={user.isActive ? "Deactivate account" : "Activate account"}
                tone={user.isActive ? "danger" : "success"}
                confirmText={user.isActive ? "Deactivate this account? The user is signed out immediately." : undefined}
              />
            )}
          </div>
        </Card>

        <Card title="Roles">
          <ul className="mb-4 divide-y divide-slate-100">
            {user.roles.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  <Badge tone={r.role === "ADMIN" ? "red" : "brand"}>{ROLE_LABELS[r.role]}</Badge>{" "}
                  <span className="text-slate-600">
                    {[r.department?.code, r.section ? `Year ${r.section.year}-${r.section.name}` : r.year ? `Year ${r.year}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {r.role !== "STUDENT" && r.role !== "PARENT" && (
                  <ActionButton action={removeRole} fields={{ id: r.id }} label="Remove" tone="danger" confirmText="Remove this role?" />
                )}
              </li>
            ))}
          </ul>
          {(user.teacher || user.roles.some((r) => r.role === "ADMIN")) && (
            <ActionForm action={addRole} submitLabel="Add role" resetOnSuccess className="space-y-3 border-t border-slate-100 pt-3">
              <input type="hidden" name="userId" value={user.id} />
              <FieldGrid cols={3}>
                <Field label="Role" name="role">
                  <Select
                    name="role"
                    options={(user.teacher ? ["HOD", "MENTOR", "TEACHER", "ADMIN"] : ["ADMIN"]).map((r) => ({
                      value: r,
                      label: ROLE_LABELS[r as keyof typeof ROLE_LABELS],
                    }))}
                  />
                </Field>
                <Field label="Department (HOD)" name="departmentId">
                  <Select name="departmentId" placeholder="–" options={departments.map((d) => ({ value: d.id, label: d.code }))} />
                </Field>
                <Field label="Section (coordinator)" name="sectionId">
                  <Select name="sectionId" placeholder="–" options={sectionOptions} />
                </Field>
              </FieldGrid>
            </ActionForm>
          )}
        </Card>

        {user.student && (
          <Card title="Student placement">
            <p className="mb-3 text-sm text-slate-600">
              Roll number <span className="font-mono">{user.student.rollNo}</span> · admitted {user.student.admissionYear}
            </p>
            <ActionForm action={updateStudentPlacement} submitLabel="Save placement">
              <input type="hidden" name="studentId" value={user.student.id} />
              <Field label="Section" name="sectionId">
                <Select name="sectionId" defaultValue={user.student.sectionId} options={sectionOptions} />
              </Field>
              <FieldGrid>
                <Field label="Lab batch" name="batchId" hint="Batches of the selected section">
                  <Select
                    name="batchId"
                    defaultValue={user.student.batchId ?? ""}
                    placeholder="None"
                    options={(sections.find((s) => s.id === user.student!.sectionId)?.batches ?? []).map((b) => ({
                      value: b.id,
                      label: b.name,
                    }))}
                  />
                </Field>
                <Field label="Class coordinator" name="mentorId">
                  <Select
                    name="mentorId"
                    defaultValue={user.student.mentorId ?? ""}
                    placeholder="None"
                    options={teachers.map((t) => ({ value: t.id, label: t.user.name }))}
                  />
                </Field>
              </FieldGrid>
            </ActionForm>
            <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-800">Parents / guardians</h3>
            <ul className="space-y-1 text-sm">
              {user.student.parents.map((p) => (
                <li key={p.parentId}>
                  {p.parent.name} <span className="text-slate-500">({p.relationship})</span> · {p.parent.email}
                  {p.parent.phone && ` · ${p.parent.phone}`}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {user.teacher && (
          <Card title="Teacher details">
            <p className="mb-3 text-sm text-slate-600">
              {user.teacher._count.subjects} classes assigned · {user.teacher._count.mentees} mentees ·{" "}
              <Link href={`/admin/academic/mapping?dept=${user.teacher.departmentId}`} className="text-brand-700 hover:underline">
                Manage subject mapping
              </Link>
            </p>
            <ActionForm action={updateTeacher} submitLabel="Save teacher details">
              <input type="hidden" name="teacherId" value={user.teacher.id} />
              <FieldGrid>
                <Field label="Department" name="departmentId">
                  <Select
                    name="departmentId"
                    defaultValue={user.teacher.departmentId}
                    options={departments.map((d) => ({ value: d.id, label: `${d.code} · ${d.programme}` }))}
                  />
                </Field>
                <Field label="Designation" name="designation">
                  <Input name="designation" defaultValue={user.teacher.designation ?? ""} />
                </Field>
              </FieldGrid>
            </ActionForm>
          </Card>
        )}

        {user.parent && (
          <Card title="Linked students">
            <ul className="space-y-1 text-sm">
              {user.parent.students.map((link) => (
                <li key={link.studentId}>
                  <Link href={`/admin/users/${link.student.userId}`} className="text-brand-700 hover:underline">
                    {link.student.user.name}
                  </Link>{" "}
                  <span className="font-mono text-xs text-slate-500">{link.student.rollNo}</span> · Year {link.student.year}-
                  {link.student.section.name}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {user.student && (
          <Card title="Registered devices">
            {user.devices.length === 0 ? (
              <EmptyState>No device yet. The first phone used to punch in is registered automatically.</EmptyState>
            ) : (
              <Table head={["Device", "Status", "First seen", ""]}>
                {user.devices.map((d) => (
                  <tr key={d.id}>
                    <td className={`${td} text-xs`}>{d.label ?? d.userAgent?.slice(0, 60) ?? "Unknown device"}</td>
                    <td className={td}>
                      <Badge tone={DEVICE_TONES[d.status]}>{d.status}</Badge>
                    </td>
                    <td className={`${td} whitespace-nowrap text-xs`}>{formatDateTime(d.createdAt)}</td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      {d.status === "PENDING" && (
                        <ActionButton action={approveDevice} fields={{ id: d.id }} label="Approve" tone="success" />
                      )}{" "}
                      {(d.status === "PENDING" || d.status === "APPROVED") && (
                        <ActionButton action={rejectDevice} fields={{ id: d.id }} label={d.status === "APPROVED" ? "Revoke" : "Reject"} tone="danger" />
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        )}

        <Card title="Recent activity" className="xl:col-span-2">
          {activity.length === 0 ? (
            <EmptyState>No activity recorded.</EmptyState>
          ) : (
            <Table head={["When", "Action", "By"]}>
              {activity.map((a) => (
                <tr key={a.id}>
                  <td className={`${td} whitespace-nowrap text-xs text-slate-600`}>{formatDateTime(a.createdAt)}</td>
                  <td className={td}>
                    <Badge>{a.action}</Badge>
                  </td>
                  <td className={td}>{a.actor?.name ?? "System"}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
