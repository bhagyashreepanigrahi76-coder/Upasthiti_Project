"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(login, undefined);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />

      {state?.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <div>
        <label htmlFor="collegeId" className="block text-sm font-medium text-slate-700">
          College ID
        </label>
        <input
          id="collegeId"
          name="collegeId"
          type="text"
          autoComplete="username"
          autoCapitalize="characters"
          spellCheck={false}
          required
          defaultValue={state?.collegeId ?? ""}
          aria-invalid={Boolean(state?.fieldErrors?.collegeId)}
          aria-describedby={state?.fieldErrors?.collegeId ? "collegeId-error" : undefined}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 uppercase shadow-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
          placeholder="e.g. S26BCA001"
        />
        {state?.fieldErrors?.collegeId && (
          <p id="collegeId-error" className="mt-1 text-xs text-red-600">
            {state.fieldErrors.collegeId}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-slate-700">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={Boolean(state?.fieldErrors?.password)}
          aria-describedby={state?.fieldErrors?.password ? "password-error" : undefined}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
        />
        {state?.fieldErrors?.password && (
          <p id="password-error" className="mt-1 text-xs text-red-600">
            {state.fieldErrors.password}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
