import type { Metadata } from "next";
import { requirePortal } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ApprovalsBoard } from "@/components/approvals-board";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const user = await requirePortal("hod");
  return (
    <>
      <PageHeader title="Approvals" subtitle="Leave and regularisation requests from students you are responsible for." />
      <ApprovalsBoard user={user} />
    </>
  );
}
