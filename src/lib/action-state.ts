// Shared result shape for form server actions (used by client forms too).
import type { z } from "zod";

export type ActionState =
  | {
      ok?: boolean;
      message?: string;
      error?: string;
      fieldErrors?: Record<string, string>;
      /** One-time value to show the admin, e.g. a temporary password. */
      secret?: string;
      /** Changes after every submit so forms can reset after success. */
      nonce?: number;
    }
  | undefined;

export function fromZodError(error: z.ZodError): ActionState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { error: "Please fix the highlighted fields.", fieldErrors, nonce: Date.now() };
}

export const success = (message: string, extra: Omit<NonNullable<ActionState>, "ok" | "message"> = {}): ActionState => ({
  ok: true,
  message,
  nonce: Date.now(),
  ...extra,
});

export const failure = (error: string): ActionState => ({ error, nonce: Date.now() });

/** Reads optional text fields: empty string becomes undefined. */
export function formValues(formData: FormData): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string" || key.startsWith("$ACTION")) continue;
    const trimmed = value.trim();
    out[key] = trimmed === "" ? undefined : trimmed;
  }
  return out;
}
