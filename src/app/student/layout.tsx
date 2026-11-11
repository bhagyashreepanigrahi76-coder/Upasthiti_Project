import { PortalShell } from "@/components/portal-shell";

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell portal="student">{children}</PortalShell>;
}
