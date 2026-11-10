import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME, COLLEGE_NAME } from "@/lib/config";
import { LoginForm } from "./login-form";
import { CollegeMark } from "@/components/college-mark";
import { PublicNoticeStrip } from "@/components/notices-ui";

export const metadata: Metadata = { title: "Sign in" };

// Demo accounts created by `npm run db:seed`. Shown only in development.
const DEMO_ACCOUNTS = [
  { id: "ADMIN01", who: "Office admin" },
  { id: "T1001", who: "Teacher + HOD (BCA)" },
  { id: "T1002", who: "Teacher + Class coordinator" },
  { id: "S26BCA001", who: "BCA student, Year 1" },
  { id: "S26BBA001", who: "BBA student, Year 1" },
  { id: "L1001", who: "Librarian" },
  { id: "P26BCA001", who: "Parent of two students" },
];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const showDemo = process.env.NODE_ENV !== "production";

  return (
    <div className="ikat-texture flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 block text-center">
          <CollegeMark size={52} className="mx-auto mb-2" />
          <span className="block text-sm font-semibold text-brand-700">{APP_NAME}</span>
          <span className="block text-xs text-slate-500">{COLLEGE_NAME}</span>
        </Link>

        <div className="overflow-hidden rounded-xl border border-brand-100 bg-white shadow-sm">
          <div className="sambalpuri-band h-3" aria-hidden="true" />
          <div className="p-6">
          <h1 className="mb-1 text-xl font-semibold text-brand-900">Sign in</h1>
          <p className="mb-5 text-sm text-slate-500">Use the college ID and password given by the office.</p>
          <Suspense fallback={<div className="h-56" />}>
            <ServerRenderedForm searchParams={searchParams} />
          </Suspense>
          <p className="mt-5 border-t border-slate-100 pt-4 text-center text-sm">
            <Link href="/account/recover" className="text-brand-700 hover:underline">
              First time here or forgot your password?
            </Link>
            <span className="mx-2 text-slate-300">·</span>
            <Link href="/privacy" className="text-slate-500 hover:underline">
              Privacy
            </Link>
          </p>
          </div>
        </div>

        <div className="mt-4">
          <Suspense fallback={null}>
            <PublicNoticeStrip />
          </Suspense>
        </div>

        {showDemo && (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white/60 p-4 text-xs text-slate-600">
            <p className="mb-2 font-semibold text-slate-700">
              Demo accounts (password <code className="font-mono">Demo@1234</code>)
            </p>
            <ul className="space-y-1">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.id} className="flex justify-between gap-3">
                  <code className="font-mono text-slate-800">{a.id}</code>
                  <span className="text-right">{a.who}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// Reads ?next= on the server so the form arrives in the HTML and works before
// JavaScript loads (slow networks, low-end phones).
async function ServerRenderedForm({ searchParams }: { searchParams: SearchParams }) {
  const { next, notice } = await searchParams;
  return (
    <>
      {notice === "password-set" && (
        <p role="status" className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Your password is set. Sign in with your new password.
        </p>
      )}
      <LoginForm next={typeof next === "string" ? next : ""} />
    </>
  );
}
