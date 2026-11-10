"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/password";
import { OTP_MESSAGES, issueOtp, verifyOtp } from "@/lib/otp";
import { collegeIdSchema, passwordPairSchema } from "@/lib/password-policy";
import { clearPending2fa, createSession, readPending2fa } from "@/lib/session";
import { clientIpFrom, hit } from "@/lib/rate-limit";
import { PRIVACY_VERSION, isUnder18 } from "@/lib/privacy";
import { verifyPassword } from "@/lib/password";
import { safeNextPath } from "@/lib/roles";
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
  redirect(user.consentAt ? homePathForRoles(user.roles) : "/account/consent");
}

// --- Activate account / forgot password (FR-1, FR-3) ---------------------

const NEUTRAL = "If that college ID is registered, a 6-digit code has been sent to its email or phone. It is valid for 10 minutes.";

export async function requestRecoveryCode(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ collegeId: collegeIdSchema }).safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  // PRD §7 rate limiting: per college ID, and a generous per-network cap (campus NAT).
  const ip = clientIpFrom(await headers());
  if (!hit(`recover-id:${parsed.data.collegeId}`, 5, 3_600_000).ok || !hit(`recover-ip:${ip}`, 200, 15 * 60_000).ok) {
    return failure("Too many code requests. Please wait a while and try again.");
  }
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

// --- Two-step sign-in (FR-3) --------------------------------------------------

export async function verifyTwoFactor(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await readPending2fa();
  if (!userId) return failure("Your sign-in has expired. Please sign in again.");
  const code = codeSchema.safeParse(String(formData.get("code") ?? ""));
  if (!code.success) return { error: "Enter the 6-digit code.", fieldErrors: { code: "Enter the 6-digit code" } };
  const check = await verifyOtp(userId, "TWO_FACTOR", code.data);
  if (check !== "ok") {
    await logAudit({ actorId: userId, action: "LOGIN_2FA_FAILED", details: { reason: check } });
    return { error: OTP_MESSAGES[check], fieldErrors: { code: OTP_MESSAGES[check] } };
  }
  const user = await db.user.findUnique({ where: { id: userId }, include: { roles: { select: { role: true } } } });
  if (!user || !user.isActive) return failure("This account is not active.");
  const roles = [...new Set(user.roles.map((r) => r.role))];
  await clearPending2fa();
  await createSession(user.id, roles, user.sessionVersion);
  await logAudit({ actorId: user.id, action: "LOGIN_SUCCESS", details: { twoFactor: true } });
  if (!user.consentAt) redirect("/account/consent");
  redirect(safeNextPath(formData.get("next"), roles) ?? homePathForRoles(roles));
}

export async function resendTwoFactor(): Promise<ActionState> {
  const userId = await readPending2fa();
  if (!userId) return failure("Your sign-in has expired. Please sign in again.");
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, phone: true } });
  if (!user) return failure("Please sign in again.");
  const r = await issueOtp(user, "TWO_FACTOR");
  return r.ok ? success(`A code was sent to ${r.sentTo}.`) : failure(r.error);
}

export async function setTwoFactor(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const enable = formData.get("enable") === "true";
  if (!user.roles.some((r) => r === "ADMIN" || r === "HOD" || r === "TEACHER" || r === "MENTOR")) return failure("Two-step sign-in is for staff accounts.");
  if (enable && !user.email && !user.phone) return failure("Add an email or phone number first (ask the office).");
  await db.user.update({ where: { id: user.id }, data: { twoFactorEnabled: enable } });
  await logAudit({ actorId: user.id, action: enable ? "TWO_FACTOR_ENABLED" : "TWO_FACTOR_DISABLED" });
  return success(enable ? "Two-step sign-in is on. Next time you sign in, we'll send you a code." : "Two-step sign-in is off.");
}

export async function changePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const v = formValues(formData);
  const pair = passwordPairSchema.safeParse({ password: v.password ?? "", confirmPassword: v.confirmPassword ?? "" });
  if (!pair.success) return fromZodError(pair.error);
  const row = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
  if (!(await verifyPassword(v.currentPassword ?? "", row.passwordHash))) {
    return { error: "Your current password is not correct.", fieldErrors: { currentPassword: "Not correct" } };
  }
  const updated = await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(pair.data.password), sessionVersion: { increment: 1 } } });
  await createSession(user.id, user.roles, updated.sessionVersion); // other devices are signed out
  await logAudit({ actorId: user.id, action: "PASSWORD_CHANGED" });
  return success("Password changed. You were signed out on other devices.");
}

// --- Privacy consent (PRD §7, DPDP Act 2023) -----------------------------------

export async function acceptConsent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser({ allowWithoutConsent: true });
  if (formData.get("agree") !== "on") return { error: "Tick the box to agree before continuing.", fieldErrors: { agree: "Required" } };
  const student = user.roles.includes("STUDENT") ? await db.student.findUnique({ where: { userId: user.id }, select: { dateOfBirth: true } }) : null;
  const minor = isUnder18(student?.dateOfBirth);
  if (minor && formData.get("guardian") !== "on") {
    return { error: "As you are under 18, a parent or guardian must also agree.", fieldErrors: { guardian: "Required for students under 18" } };
  }
  const version = minor ? `${PRIVACY_VERSION}+guardian` : PRIVACY_VERSION;
  await db.user.update({ where: { id: user.id }, data: { consentAt: new Date(), consentVersion: version } });
  await logAudit({ actorId: user.id, action: "PRIVACY_CONSENT_GIVEN", details: { version } });
  redirect(homePathForRoles(user.roles));
}
