import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/config";
import { Badge, Card, EmptyState, PageHeader, Table, td } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { approveDevice, rejectDevice } from "./actions";

export const metadata: Metadata = { title: "Devices" };

const TONES = { PENDING: "amber", APPROVED: "green", REJECTED: "red", REVOKED: "slate" } as const;

export default async function DevicesPage() {
  await requireRole("ADMIN");
  const [pending, recent] = await Promise.all([
    db.device.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: { user: { include: { student: { include: { section: true, department: true } } } } },
    }),
    db.device.findMany({
      where: { status: { not: "PENDING" } },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { user: true },
    }),
  ]);

  const currentDevices = await db.device.findMany({
    where: { status: "APPROVED", userId: { in: pending.map((p) => p.userId) } },
  });

  return (
    <>
      <PageHeader title="Devices" subtitle="Each student punches from one approved phone (FR-4). Approving a new phone revokes the old one." />

      <Card title={`Waiting for approval (${pending.length})`}>
        {pending.length === 0 ? (
          <EmptyState>No device change requests.</EmptyState>
        ) : (
          <Table head={["Student", "New device", "Current device", "Requested", ""]}>
            {pending.map((d) => {
              const current = currentDevices.find((c) => c.userId === d.userId);
              return (
                <tr key={d.id}>
                  <td className={td}>
                    <Link href={`/admin/users/${d.userId}`} className="font-medium text-brand-700 hover:underline">
                      {d.user.name}
                    </Link>
                    <span className="block text-xs text-slate-500">
                      {d.user.collegeId}
                      {d.user.student && ` · ${d.user.student.department.code} Y${d.user.student.year}-${d.user.student.section.name}`}
                    </span>
                  </td>
                  <td className={`${td} text-xs`}>{d.label ?? "Unknown"}</td>
                  <td className={`${td} text-xs text-slate-500`}>{current ? `${current.label ?? "Unknown"} (since ${formatDateTime(current.createdAt)})` : "None"}</td>
                  <td className={`${td} whitespace-nowrap text-xs`}>{formatDateTime(d.createdAt)}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    <ActionButton action={approveDevice} fields={{ id: d.id }} label="Approve" tone="success" />{" "}
                    <ActionButton action={rejectDevice} fields={{ id: d.id }} label="Reject" tone="danger" />
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <Card title="Recent device decisions" className="mt-6">
        {recent.length === 0 ? (
          <EmptyState>Nothing yet.</EmptyState>
        ) : (
          <Table head={["Student", "Device", "Status", "Registered"]}>
            {recent.map((d) => (
              <tr key={d.id}>
                <td className={td}>
                  {d.user.name} <span className="font-mono text-xs text-slate-500">{d.user.collegeId}</span>
                </td>
                <td className={`${td} text-xs`}>{d.label ?? "Unknown"}</td>
                <td className={td}>
                  <Badge tone={TONES[d.status]}>{d.status}</Badge>
                </td>
                <td className={`${td} whitespace-nowrap text-xs`}>{formatDateTime(d.createdAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
