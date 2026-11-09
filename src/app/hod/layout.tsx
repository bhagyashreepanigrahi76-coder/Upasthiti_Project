import { PortalShell } from "@/components/portal-shell";

export default function HodLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell portal="hod">{children}</PortalShell>;
}
