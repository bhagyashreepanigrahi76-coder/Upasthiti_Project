import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { ROLE_LABELS, ROLES, isRole } from "@/lib/roles";
import { formatDateTime } from "@/lib/config";
import { Badge, Card, EmptyState, PageHeader, Table, td } from "@/components/ui";
import { inputClass } from "@/components/form-fields";
import { textContains } from "@/lib/db-search";

export const metadata: Metadata = { title: "Users" };

const PAGE_SIZE = 25;
type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function UsersPage({ searchParams }: Props) {
  await requireRole("ADMIN");
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const role = isRole(sp.role) ? sp.role : undefined;
  const dept = sp.dept || undefined;
  const status = sp.status === "inactive" ? "inactive" : sp.status === "all" ? "all" : "active";
  const page = Math.max(1, Number(sp.page) || 1);

  const filters: Prisma.UserWhereInput[] = [];
  if (q) {
    filters.push({
      OR: [{ name: textContains(q) }, { collegeId: textContains(q.toUpperCase()) }, { email: textContains(q.toLowerCase()) }],
    });
  }
  if (role) filters.push({ roles: { some: { role } } });
  if (dept) filters.push({ OR: [{ student: { departmentId: dept } }, { teacher: { departmentId: dept } }] });
  if (status !== "all") filters.push({ isActive: status === "active" });
  const where: Prisma.UserWhereInput = { AND: filters };

  const [total, users, departments] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: { collegeId: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        roles: { select: { role: true } },
        student: { include: { department: true, section: true } },
        teacher: { include: { department: true } },
      },
    }),
    db.department.findMany({ orderBy: { code: "asc" } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (role) params.set("role", role);
    if (dept) params.set("dept", dept);
    if (status !== "active") params.set("status", status);
    params.set("page", String(p));
    return `/admin/users?${params}`;
  };

  return (
    <>
      <PageHeader title="Users" subtitle={`${total} matching account${total === 1 ? "" : "s"}`}>
        <div className="flex gap-2">
          <Link href="/admin/import" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Bulk import
          </Link>
          <Link href="/admin/users/new" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Add user
          </Link>
        </div>
      </PageHeader>

      <Card>
        <form method="get" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <input name="q" defaultValue={q} placeholder="Search name, ID or email" className={`${inputClass} lg:col-span-2`} />
          <select name="role" defaultValue={role ?? ""} className={inputClass} aria-label="Role">
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <select name="dept" defaultValue={dept ?? ""} className={inputClass} aria-label="Department">
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <select name="status" defaultValue={status} className={inputClass} aria-label="Status">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </select>
            <button className="rounded-md bg-slate-800 px-3 text-sm font-medium text-white">Filter</button>
          </div>
        </form>

        {users.length === 0 ? (
          <EmptyState>No users match these filters.</EmptyState>
        ) : (
          <Table head={["College ID", "Name", "Roles", "Department", "Status", "Last sign-in"]}>
            {users.map((u) => {
              const deptCode = u.student?.department.code ?? u.teacher?.department.code;
              return (
                <tr key={u.id}>
                  <td className={`${td} font-mono text-xs`}>
                    <Link href={`/admin/users/${u.id}`} className="text-brand-700 hover:underline">
                      {u.collegeId}
                    </Link>
                  </td>
                  <td className={td}>
                    <Link href={`/admin/users/${u.id}`} className="font-medium text-slate-900 hover:underline">
                      {u.name}
                    </Link>
                    {u.student && (
                      <span className="block text-xs text-slate-500">
                        Year {u.student.year} · {u.student.section.name}
                      </span>
                    )}
                  </td>
                  <td className={td}>
                    <div className="flex flex-wrap gap-1">
                      {[...new Set(u.roles.map((r) => r.role))].map((r) => (
                        <Badge key={r} tone={r === "ADMIN" ? "red" : r === "STUDENT" ? "slate" : "brand"}>
                          {ROLE_LABELS[r]}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className={td}>{deptCode ?? "–"}</td>
                  <td className={td}>
                    {!u.isActive ? (
                      <Badge tone="red">Inactive</Badge>
                    ) : u.mustChangePassword ? (
                      <Badge tone="amber">Not activated</Badge>
                    ) : (
                      <Badge tone="green">Active</Badge>
                    )}
                  </td>
                  <td className={`${td} whitespace-nowrap text-xs text-slate-500`}>
                    {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}

        {pages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-slate-500">
              Page {page} of {pages}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={qs(page - 1)} className="rounded-md border border-slate-300 px-3 py-1">
                  Previous
                </Link>
              )}
              {page < pages && (
                <Link href={qs(page + 1)} className="rounded-md border border-slate-300 px-3 py-1">
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
