"use client";

import { createContext, useActionState, useContext, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/action-state";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const FormStateContext = createContext<ActionState>(undefined);

const buttonTones = {
  primary: "bg-brand-600 text-white hover:bg-brand-700",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50",
  success: "bg-emerald-600 text-white hover:bg-emerald-700",
} as const;
export type ButtonTone = keyof typeof buttonTones;

export function SubmitButton({
  children,
  pendingLabel = "Saving…",
  tone = "primary",
  size = "md",
  confirmText,
  name,
  value,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  tone?: ButtonTone;
  size?: "sm" | "md";
  confirmText?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      onClick={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
      className={`inline-flex items-center justify-center rounded-md font-medium disabled:opacity-60 ${
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-4 py-2 text-sm"
      } ${buttonTones[tone]}`}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

/** Form bound to a server action, with success/error banner and field errors. */
export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  pendingLabel,
  tone = "primary",
  resetOnSuccess = false,
  className = "space-y-4",
  confirmText,
}: {
  action: Action;
  children?: React.ReactNode;
  submitLabel?: string | null;
  pendingLabel?: string;
  tone?: ButtonTone;
  resetOnSuccess?: boolean;
  className?: string;
  confirmText?: string;
}) {
  // File inputs work without encType: React sends multipart data for function actions.
  const [state, formAction] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state?.nonce, state?.ok, resetOnSuccess]);

  return (
    <FormStateContext value={state}>
      <form ref={ref} action={formAction} className={className} noValidate>
        <FormBanner state={state} />
        {children}
        {submitLabel !== null && (
          <div>
            <SubmitButton tone={tone} pendingLabel={pendingLabel} confirmText={confirmText}>
              {submitLabel}
            </SubmitButton>
          </div>
        )}
      </form>
    </FormStateContext>
  );
}

export function FormBanner({ state }: { state: ActionState }) {
  if (!state?.message && !state?.error) return null;
  return (
    <div
      role={state.error ? "alert" : "status"}
      className={`rounded-md px-3 py-2 text-sm ${state.error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}
    >
      <p className="whitespace-pre-line">{state.error ?? state.message}</p>
      {state.secret && (
        <p className="mt-1">
          <code className="select-all rounded bg-white px-2 py-0.5 font-mono text-base text-slate-900">
            {state.secret}
          </code>
          <span className="ml-2 text-xs">Shown once. Share it with the user directly.</span>
        </p>
      )}
    </div>
  );
}

export function FieldError({ name }: { name: string }) {
  const state = useContext(FormStateContext);
  const message = state?.fieldErrors?.[name];
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-600">{message}</p>;
}

/**
 * One-button form for row actions (delete, approve, toggle). Hidden fields
 * carry the IDs; errors appear next to the button.
 */
export function ActionButton({
  action,
  fields,
  label,
  pendingLabel = "…",
  tone = "secondary",
  confirmText,
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  pendingLabel?: string;
  tone?: ButtonTone;
  confirmText?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className="inline-flex flex-col items-start">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton size="sm" tone={tone} pendingLabel={pendingLabel} confirmText={confirmText}>
        {label}
      </SubmitButton>
      {state?.error && <span className="mt-1 max-w-56 text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
