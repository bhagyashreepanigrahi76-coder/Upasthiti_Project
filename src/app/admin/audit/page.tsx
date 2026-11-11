import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditWhere } from "@/lib/audit-query";
import { formatDateTime } from "@/lib/config";
import { Badge, Card, EmptyState, PageHeader, Table, td } from "@/components/ui";
import { inputClass } from "@/components/form-fields";

export const metadata: Metadata = { title: "Audit log" };

const PAGE = 50;
type Props = { searchParams: Promise<Record<string, string | undefined>> };

// FR-30: logins, edits, approvals and report sends, with who and when.
export default async function AuditLogPage({ searchParams }: Props) {
  await requireRole("ADMIN");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where = await auditWhere(sp);
  const [total, rows, entities] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { actor: { select: { name: true, collegeId: true } } } }),
    db.auditLog.findMany({ where: { entityType: { not: null } }, distinct: ["entityType"], select: { entityType: true } }),
  ]);
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v) as [string, string][]), ...extra }).toString();
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <>
      <PageHeader title="Audit log" subtitle={`${total} entries match`}>
        <a href={`/api/exports/audit?${qs({})}`} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Export CSV
        </a>
      </PageHeader>
      <Card>
        <form method="get" className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <input name="action" defaultValue={sp.action} placeholder="Action, e.g. LOGIN" className={inputClass} aria-label="Action" />
          <input name="actor" defaultValue={sp.actor} placeholder="Who (college ID)" className={inputClass} aria-label="Actor college ID" />
          <select name="entity" defaultValue={sp.entity ?? ""} className={inputClass} aria-label="Record type">
            <option value="">Any record</option>
            {entities.map((e) => (
              <option key={e.entityType} value={e.entityType!}>
                {e.entityType}
              </option>
            ))}
          </select>
          <input name="from" type="date" defaultValue={sp.from} className={inputClass} aria-label="From" />
          <input name="to" type="date" defaultValue={sp.to} className={inputClass} aria-label="To" />
          <button className="rounded-md bg-slate-800 px-3 text-sm font-medium text-white">Filter</button>
        </form>
        {rows.length === 0 ? (
          <EmptyState>No entries match.</EmptyState>
        ) : (
          <Table head={["When", "Who", "Action", "Record", "Details", "IP"]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={`${td} whitespace-nowrap text-xs`}>{formatDateTime(r.createdAt)}</td>
                <td className={`${td} text-xs`}>{r.actor ? `${r.actor.name} (${r.actor.collegeId})` : "System"}</td>
                <td className={td}>
                  <Badge tone={r.action.includes("FAILED") || r.action.includes("BLOCKED") ? "red" : "slate"}>{r.action}</Badge>
                </td>
                <td className={`${td} text-xs text-slate-500`}>{r.entityType ?? "–"}</td>
                <td className={`${td} max-w-md break-all font-mono text-[11px] text-slate-600`}>{r.details?.slice(0, 240) ?? ""}</td>
                <td className={`${td} font-mono text-xs text-slate-500`}>{r.ipAddress ?? ""}</td>
              </tr>
            ))}
          </Table>
        )}
        {pages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-slate-500">
              Page {page} of {pages}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={`/admin/audit?${qs({ page: String(page - 1) })}`} className="rounded-md border border-slate-300 px-3 py-1">
                  Previous
                </Link>
              )}
              {page < pages && (
                <Link href={`/admin/audit?${qs({ page: String(page + 1) })}`} className="rounded-md border border-slate-300 px-3 py-1">
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
