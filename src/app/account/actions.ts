"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/password";
import { OTP_MESSAGES, issueOtp, verifyOtp } from "@/lib/otp";
import { collegeIdSchema, passwordPairSchema } from "@/lib/password-policy";
import { createSession } from "@/lib/session";
import { homePathForRoles } from "@/lib/roles";
import { type ActionState, failure, formValues, fromZodError, success } from "@/lib/action-state";

const codeSchema = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code");

// --- First sign-in with an issued password (FR-1) ---------------------------

export async function sendSetupCode(): Promise<ActionState> {
  const user = await requireUser({ allowPendingSetup: true });
  const result = await issueOtp(user, "FIRST_LOGIN");
  if (!result.ok) return failure(result.error);
  return success(`We sent a 6-digit code to ${result.sentTo}. It is valid for 10 minutes.`);
}

export async function completeSetup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser({ allowPendingSetup: true });
  const values = formValues(formData);
  const code = codeSchema.safeParse(values.code ?? "");
  const pair = passwordPairSchema.safeParse({ password: values.password ?? "", confirmPassword: values.confirmPassword ?? "" });
  if (!code.success) return { error: "Enter the 6-digit code.", fieldErrors: { code: "Enter the 6-digit code" } };
  if (!pair.success) return fromZodError(pair.error);

  const check = await verifyOtp(user.id, "FIRST_LOGIN", code.data);
  if (check !== "ok") return { error: OTP_MESSAGES[check], fieldErrors: { code: OTP_MESSAGES[check] } };

  const updated = await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(pair.data.password), mustChangePassword: false, sessionVersion: { increment: 1 } },
  });
  // Other sessions end; this one is renewed with the new version.
  await createSession(user.id, user.roles, updated.sessionVersion);
  await logAudit({ actorId: user.id, action: "FIRST_LOGIN_COMPLETED" });
  redirect(homePathForRoles(user.roles));
}

// --- Activate account / forgot password (FR-1, FR-3) ---------------------

const NEUTRAL = "If that college ID is registered, a 6-digit code has been sent to its email or phone. It is valid for 10 minutes.";

export async function requestRecoveryCode(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ collegeId: collegeIdSchema }).safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const user = await db.user.findUnique({
    where: { collegeId: parsed.data.collegeId },
    select: { id: true, name: true, email: true, phone: true, isActive: true },
  });
  // Same answer whether or not the ID exists, so IDs cannot be probed.
  if (user?.isActive) {
    const result = await issueOtp(user, "PASSWORD_RESET");
    await logAudit({ actorId: user.id, action: "PASSWORD_CODE_REQUESTED", details: { delivered: result.ok } });
  }
  return success(NEUTRAL);
}

export async function completeRecovery(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData);
  const parsed = z
    .object({ collegeId: collegeIdSchema, code: codeSchema })
    .safeParse({ collegeId: values.collegeId ?? "", code: values.code ?? "" });
  if (!parsed.success) return fromZodError(parsed.error);
  const pair = passwordPairSchema.safeParse({ password: values.password ?? "", confirmPassword: values.confirmPassword ?? "" });
  if (!pair.success) return fromZodError(pair.error);

  const user = await db.user.findUnique({ where: { collegeId: parsed.data.collegeId }, select: { id: true, isActive: true } });
  if (!user || !user.isActive) return { error: OTP_MESSAGES.invalid, fieldErrors: { code: OTP_MESSAGES.invalid } };

  const check = await verifyOtp(user.id, "PASSWORD_RESET", parsed.data.code);
  if (check !== "ok") return { error: OTP_MESSAGES[check], fieldErrors: { code: OTP_MESSAGES[check] } };

  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(pair.data.password),
      mustChangePassword: false, // the code proves they own the email/phone
      failedLoginCount: 0,
      lockedUntil: null,
      sessionVersion: { increment: 1 }, // sign out every existing session
    },
  });
  await logAudit({ actorId: user.id, action: "PASSWORD_RESET_WITH_CODE" });
  redirect("/login?notice=password-set");
}
