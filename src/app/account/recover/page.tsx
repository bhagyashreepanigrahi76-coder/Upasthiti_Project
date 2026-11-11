import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/forms";
import { Field, Input } from "@/components/form-fields";
import { completeRecovery, requestRecoveryCode } from "../actions";

export const metadata: Metadata = { title: "Activate account or reset password" };

// FR-1 / FR-3: first-time activation and forgotten passwords use the same
// flow: a code sent to the email or phone on file, then a new password.
export default function RecoverPage() {
  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900">Activate account or reset password</h1>
      <p className="mt-1 text-sm text-slate-600">
        First time here, or forgot your password? We&apos;ll send a code to the email or phone the college has on file.
      </p>

      <div className="mt-5 rounded-lg bg-slate-50 p-4">
        <p className="mb-3 text-sm font-medium text-slate-700">Step 1: get a code</p>
        <ActionForm action={requestRecoveryCode} submitLabel="Send code" pendingLabel="Sending…" tone="secondary">
          <Field label="College ID" name="collegeId">
            <Input name="collegeId" autoCapitalize="characters" autoComplete="username" className="uppercase" />
          </Field>
        </ActionForm>
      </div>

      <div className="mt-5">
        <p className="mb-3 text-sm font-medium text-slate-700">Step 2: set your password</p>
        <ActionForm action={completeRecovery} submitLabel="Set password">
          <Field label="College ID" name="collegeId">
            <Input name="collegeId" autoCapitalize="characters" className="uppercase" />
          </Field>
          <Field label="6-digit code" name="code">
            <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
          </Field>
          <Field label="New password" name="password" hint="At least 8 characters, with a letter and a number.">
            <Input name="password" type="password" autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password" name="confirmPassword">
            <Input name="confirmPassword" type="password" autoComplete="new-password" />
          </Field>
        </ActionForm>
      </div>

      <p className="mt-6 border-t border-slate-100 pt-4 text-sm">
        <Link href="/login" className="text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
