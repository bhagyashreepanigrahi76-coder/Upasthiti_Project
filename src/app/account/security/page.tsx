import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { homePathForRoles } from "@/lib/roles";
import { formatDateTime } from "@/lib/config";
import { ActionForm } from "@/components/forms";
import { Field, Input } from "@/components/form-fields";
import { Skeleton } from "@/components/ui";
import { changePassword, setTwoFactor } from "../actions";

export const metadata: Metadata = { title: "Account and security" };

export default function SecurityPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Security />
    </Suspense>
  );
}

async function Security() {
  const user = await requireUser();
  const staff = user.roles.some((r) => r === "ADMIN" || r === "HOD" || r === "TEACHER" || r === "MENTOR");
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Account and security</h1>
        <Link href={homePathForRoles(user.roles)} className="text-sm text-brand-700 hover:underline">
          Back
        </Link>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {user.name} · {user.collegeId}
        {user.consentAt ? ` · privacy notice accepted ${formatDateTime(user.consentAt)}` : ""}
      </p>

      <h2 className="mb-3 mt-6 text-sm font-semibold text-slate-800">Change password</h2>
      <ActionForm action={changePassword} submitLabel="Change password" resetOnSuccess>
        <Field label="Current password" name="currentPassword">
          <Input name="currentPassword" type="password" autoComplete="current-password" />
        </Field>
        <Field label="New password" name="password" hint="At least 8 characters, with a letter and a number.">
          <Input name="password" type="password" autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password" name="confirmPassword">
          <Input name="confirmPassword" type="password" autoComplete="new-password" />
        </Field>
      </ActionForm>

      {staff && (
        <div className="mt-6 border-t border-slate-100 pt-5">
          <h2 className="text-sm font-semibold text-slate-800">Two-step sign-in</h2>
          <p className="mt-1 text-sm text-slate-600">
            {user.twoFactorEnabled
              ? "On: after your password we send a 6-digit code to your email or phone."
              : "Off. Turn it on to require a code sent to your email or phone each time you sign in."}
          </p>
          <ActionForm
            action={setTwoFactor}
            submitLabel={user.twoFactorEnabled ? "Turn off" : "Turn on two-step sign-in"}
            tone={user.twoFactorEnabled ? "secondary" : "primary"}
            className="mt-3 space-y-2"
          >
            <input type="hidden" name="enable" value={String(!user.twoFactorEnabled)} />
          </ActionForm>
        </div>
      )}
    </>
  );
}
