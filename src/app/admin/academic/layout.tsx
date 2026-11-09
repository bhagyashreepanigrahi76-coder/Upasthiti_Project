import { SubNav } from "@/components/sub-nav";

const TABS = [
  { label: "Years & departments", href: "/admin/academic" },
  { label: "Sections & batches", href: "/admin/academic/sections" },
  { label: "Subjects", href: "/admin/academic/subjects" },
  { label: "Teacher mapping", href: "/admin/academic/mapping" },
];

export default function AcademicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight text-slate-900">Academic setup</h1>
      <SubNav items={TABS} />
      {children}
    </>
  );
}
