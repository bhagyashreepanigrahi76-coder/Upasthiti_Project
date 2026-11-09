import { PortalShell } from "@/components/portal-shell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell portal="admin">{children}</PortalShell>;
}
