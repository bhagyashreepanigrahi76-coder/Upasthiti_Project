import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { homePathForRoles } from "@/lib/roles";
import { PRIVACY_SECTIONS, isUnder18 } from "@/lib/privacy";
import { ActionForm, FieldError } from "@/components/forms";
import { Skeleton } from "@/components/ui";
import { logout } from "@/app/login/actions";
import { acceptConsent } from "../actions";

export const metadata: Metadata = { title: "Privacy notice" };

// PRD §7 / DPDP Act 2023: explicit consent before any data is collected.
export default function ConsentPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Consent />
    </Suspense>
  );
}

async function Consent() {
  const user = await requireUser({ allowWithoutConsent: true });
  if (user.consentAt) redirect(homePathForRoles(user.roles));
  const student = user.roles.includes("STUDENT") ? await db.student.findUnique({ where: { userId: user.id }, select: { dateOfBirth: true } }) : null;
  const minor = isUnder18(student?.dateOfBirth);
  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900">Before you start: your privacy</h1>
      <p className="mt-1 text-sm text-slate-600">Please read how the college uses your information.</p>
      <div className="mt-4 max-h-80 space-y-3 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        {PRIVACY_SECTIONS.map((s) => (
          <section key={s.title}>
            <h2 className="font-semibold text-slate-900">{s.title}</h2>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {s.body.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <ActionForm action={acceptConsent} submitLabel="Agree and continue" className="mt-4 space-y-3">
        <label className="flex items-start gap-2 text-sm text-slate-800">
          <input type="checkbox" name="agree" className="mt-0.5 h-4 w-4" />
          <span>
            I have read the privacy notice and agree to the college processing my information as described, including my location at the moment I
            punch in or out.
          </span>
        </label>
        <FieldError name="agree" />
        {minor && (
          <>
            <label className="flex items-start gap-2 text-sm text-slate-800">
              <input type="checkbox" name="guardian" className="mt-0.5 h-4 w-4" />
              <span>I am under 18. My parent or guardian has read this notice and agrees.</span>
            </label>
            <FieldError name="guardian" />
          </>
        )}
      </ActionForm>
      <div className="mt-4 flex justify-between border-t border-slate-100 pt-4 text-sm">
        <Link href="/privacy" className="text-brand-700 hover:underline">
          Full privacy notice
        </Link>
        <form action={logout}>
          <button className="text-slate-500 hover:underline">Sign out</button>
        </form>
      </div>
    </>
  );
}
