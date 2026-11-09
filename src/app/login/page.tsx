import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME, COLLEGE_NAME } from "@/lib/config";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

// Demo accounts created by `npm run db:seed`. Shown only in development.
const DEMO_ACCOUNTS = [
  { id: "ADMIN01", who: "Office admin" },
  { id: "T1001", who: "Teacher + HOD (Computer Science)" },
  { id: "T1002", who: "Teacher + Class coordinator" },
  { id: "S26CS001", who: "Student, Year 1" },
  { id: "P26CS001", who: "Parent of two students" },
];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const showDemo = process.env.NODE_ENV !== "production";

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 block text-center">
          <span className="block text-sm font-semibold text-brand-700">{APP_NAME}</span>
          <span className="block text-xs text-slate-500">{COLLEGE_NAME}</span>
        </Link>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="mb-1 text-xl font-semibold text-slate-900">Sign in</h1>
          <p className="mb-5 text-sm text-slate-500">Use the college ID and password given by the office.</p>
          <Suspense fallback={<div className="h-56" />}>
            <ServerRenderedForm searchParams={searchParams} />
          </Suspense>
          <p className="mt-5 border-t border-slate-100 pt-4 text-center text-sm">
            <Link href="/account/recover" className="text-brand-700 hover:underline">
              First time here or forgot your password?
            </Link>
          </p>
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
