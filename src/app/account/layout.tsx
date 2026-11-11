import Link from "next/link";
import { APP_NAME, COLLEGE_NAME } from "@/lib/config";
import { CollegeMark } from "@/components/college-mark";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ikat-texture flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 block text-center">
          <CollegeMark size={44} className="mx-auto mb-2" />
          <span className="block text-sm font-semibold text-brand-700">{APP_NAME}</span>
          <span className="block text-xs text-slate-500">{COLLEGE_NAME}</span>
        </Link>
        <div className="overflow-hidden rounded-xl border border-brand-100 bg-white shadow-sm">
          <div className="sambalpuri-band h-3" aria-hidden="true" />
          <div className="p-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
