import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/forms";
import { Field, Input } from "@/components/form-fields";
import { resendTwoFactor, verifyTwoFactor } from "../actions";

export const metadata: Metadata = { title: "Enter your sign-in code" };

type Props = { searchParams: Promise<{ next?: string }> };

// FR-3: second step for staff who turned on two-step sign-in.
export default function VerifyPage({ searchParams }: Props) {
  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900">Enter your sign-in code</h1>
      <p className="mt-1 text-sm text-slate-600">We sent a 6-digit code to your email or phone. It is valid for 10 minutes.</p>
      <Suspense fallback={null}>
        <CodeForm searchParams={searchParams} />
      </Suspense>
      <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-sm">
        <ActionForm action={resendTwoFactor} submitLabel="Send a new code" tone="secondary" className="space-y-2" />
        <Link href="/login" className="text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </div>
    </>
  );
}

async function CodeForm({ searchParams }: Props) {
  const { next } = await searchParams;
  return (
    <ActionForm action={verifyTwoFactor} submitLabel="Verify and sign in" className="mt-5 space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="6-digit code" name="code">
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
      </Field>
    </ActionForm>
  );
}
