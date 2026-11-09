import Link from "next/link";
import { APP_NAME, COLLEGE_NAME } from "@/lib/config";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 block text-center">
          <span className="block text-sm font-semibold text-brand-700">{APP_NAME}</span>
          <span className="block text-xs text-slate-500">{COLLEGE_NAME}</span>
        </Link>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
      </div>
    </div>
  );
}
