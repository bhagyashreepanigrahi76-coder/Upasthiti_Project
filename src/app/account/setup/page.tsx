import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { homePathForRoles } from "@/lib/roles";
import { maskEmail, maskPhone } from "@/lib/otp";
import { ActionForm } from "@/components/forms";
import { Field, Input } from "@/components/form-fields";
import { Skeleton } from "@/components/ui";
import { logout } from "@/app/login/actions";
import { completeSetup, sendSetupCode } from "../actions";

export const metadata: Metadata = { title: "Finish setting up your account" };

export default function SetupPage() {
  return (
    <Suspense fallback={<Skeleton className="h-80" />}>
      <SetupForm />
    </Suspense>
  );
}

async function SetupForm() {
  const user = await requireUser({ allowPendingSetup: true });
  if (!user.mustChangePassword) redirect(homePathForRoles(user.roles));
  const destination = user.email ? maskEmail(user.email) : user.phone ? maskPhone(user.phone) : null;

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900">Welcome, {user.name.split(" ")[0]}</h1>
      <p className="mt-1 text-sm text-slate-600">
        Before you start, confirm it&apos;s you with a one-time code and choose your own password.
      </p>

      {destination ? (
        <>
          <div className="mt-5 rounded-lg bg-slate-50 p-4">
            <p className="mb-3 text-sm text-slate-700">
              Step 1: send a code to <strong>{destination}</strong>
            </p>
            <ActionForm action={sendSetupCode} submitLabel="Send code" pendingLabel="Sending…" tone="secondary" className="space-y-3" />
          </div>

          <div className="mt-5">
            <p className="mb-3 text-sm text-slate-700">Step 2: enter the code and your new password</p>
            <ActionForm action={completeSetup} submitLabel="Save and continue">
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
        </>
      ) : (
        <p className="mt-5 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          No email or phone number is on file, so we can&apos;t send a code. Please ask the college office to add one.
        </p>
      )}

      <form action={logout} className="mt-6 border-t border-slate-100 pt-4">
        <button className="text-sm text-slate-500 hover:underline">Sign out</button>
      </form>
    </>
  );
}
