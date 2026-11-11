import type { Metadata } from "next";
import Link from "next/link";
import { PRIVACY_SECTIONS, PRIVACY_VERSION } from "@/lib/privacy";
import { APP_NAME, COLLEGE_NAME } from "@/lib/config";

export const metadata: Metadata = { title: "Privacy notice" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/" className="text-sm font-semibold text-brand-700">
        {APP_NAME}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold text-slate-900">Privacy notice</h1>
      <p className="mt-1 text-sm text-slate-500">
        {COLLEGE_NAME} · version {PRIVACY_VERSION}
      </p>
      <div className="mt-6 space-y-5 text-sm text-slate-700">
        {PRIVACY_SECTIONS.map((s) => (
          <section key={s.title}>
            <h2 className="text-base font-semibold text-slate-900">{s.title}</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {s.body.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
