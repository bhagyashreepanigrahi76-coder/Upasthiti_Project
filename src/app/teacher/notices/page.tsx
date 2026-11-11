import type { Metadata } from "next";
import { requirePortal } from "@/lib/auth";
import { NoticeManager } from "@/components/notice-manager";

export const metadata: Metadata = { title: "Notices" };

type Props = { searchParams: Promise<{ edit?: string }> };

export default async function ManageNoticesPage({ searchParams }: Props) {
  const user = await requirePortal("teacher");
  const { edit } = await searchParams;
  return <NoticeManager user={user} basePath="/teacher/notices" editId={edit} />;
}
