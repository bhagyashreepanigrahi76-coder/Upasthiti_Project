import { PortalShell } from "@/components/portal-shell";

export default function LibraryLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell portal="library">{children}</PortalShell>;
}
