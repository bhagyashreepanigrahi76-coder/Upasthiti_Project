import { PortalShell } from "@/components/portal-shell";

export default function ParentLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell portal="parent">{children}</PortalShell>;
}
