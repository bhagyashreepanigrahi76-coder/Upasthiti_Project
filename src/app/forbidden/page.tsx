import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "No access" };

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">You don&apos;t have access to this page</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your account does not have the role this page needs. If you think this is wrong, contact the college
          office.
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <Link
            href="/select-role"
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Go to my portal
          </Link>
          <Link href="/" className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
