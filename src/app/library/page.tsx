import type { Metadata } from "next";
import { requirePortal } from "@/lib/auth";
import { LibraryManager } from "@/components/library-manager";

export const metadata: Metadata = { title: "Library" };

type Props = { searchParams: Promise<{ q?: string; category?: string; edit?: string }> };

export default async function LibraryPage({ searchParams }: Props) {
  await requirePortal("library");
  const { q, category, edit } = await searchParams;
  return <LibraryManager basePath="/library" q={q} category={category} editId={edit} />;
}
