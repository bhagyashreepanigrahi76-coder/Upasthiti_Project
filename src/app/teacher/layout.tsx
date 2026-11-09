import { PortalShell } from "@/components/portal-shell";

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell portal="teacher">{children}</PortalShell>;
}
