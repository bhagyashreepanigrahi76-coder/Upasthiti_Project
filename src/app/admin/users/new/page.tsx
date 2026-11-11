import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { NewUserForm } from "./new-user-form";

export const metadata: Metadata = { title: "Add user" };

export default async function NewUserPage() {
  await requireRole("ADMIN");
  const currentYear = await db.academicYear.findFirst({ where: { isCurrent: true } });
  const [departments, sections, teachers] = await Promise.all([
    db.department.findMany({ orderBy: { code: "asc" } }),
    db.section.findMany({
      where: { academicYearId: currentYear?.id },
      orderBy: [{ department: { code: "asc" } }, { year: "asc" }, { name: "asc" }],
      include: { department: true, batches: { orderBy: { name: "asc" } } },
    }),
    db.teacher.findMany({ include: { user: true }, orderBy: { user: { name: "asc" } } }),
  ]);

  return (
    <>
      <PageHeader
        title="Add user"
        subtitle={
          <>
            For many users at once, use <Link href="/admin/import" className="text-brand-700 underline">bulk import</Link>.
          </>
        }
      />
      <Card className="max-w-3xl">
        <NewUserForm
          departments={departments.map((d) => ({ value: d.id, label: `${d.code} · ${d.programme}` }))}
          sections={sections.map((s) => ({
            value: s.id,
            label: `${s.department.code} · Year ${s.year} · ${s.name}`,
            departmentId: s.departmentId,
            batches: s.batches.map((b) => ({ value: b.id, label: b.name })),
          }))}
          teachers={teachers.map((t) => ({ value: t.id, label: t.user.name }))}
          defaultAdmissionYear={currentYear ? currentYear.startDate.getUTCFullYear() : 2026}
        />
      </Card>
    </>
  );
}
