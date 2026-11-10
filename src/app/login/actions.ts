"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSession, deleteSession, readSession, setPending2fa } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { homePathForRoles, safeNextPath } from "@/lib/roles";
import { issueOtp } from "@/lib/otp";
import { clientIpFrom, hit, peek } from "@/lib/rate-limit";

const MAX_FAILED_ATTEMPTS = 5; // per account, then a 15-minute lock
const LOCK_MINUTES = 15;
// Per network, only failed attempts count: a whole campus often shares one
// public IP, so successful sign-ins must never be limited by IP.
const IP_FAILURES = 50;
const IP_WINDOW_MS = 15 * 60_000;

const loginSchema = z.object({
  collegeId: z
    .string()
    .trim()
    .min(1, "Enter your college ID")
    .max(32, "College ID is too long")
    .transform((s) => s.toUpperCase()),
  password: z.string().min(1, "Enter your password").max(128),
  next: z.string().optional(),
});

export type LoginState =
  | {
      error?: string;
      fieldErrors?: { collegeId?: string; password?: string };
      collegeId?: string;
    }
  | undefined;

const GENERIC_ERROR = "Invalid college ID or password.";

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    collegeId: formData.get("collegeId") ?? "",
    password: formData.get("password") ?? "",
    next: formData.get("next") || undefined,
  });
  if (!parsed.success) {
    const fe = z.flattenError(parsed.error).fieldErrors;
    return {
      fieldErrors: { collegeId: fe.collegeId?.[0], password: fe.password?.[0] },
      collegeId: String(formData.get("collegeId") ?? ""),
    };
  }
  const { collegeId, password, next } = parsed.data;

  const ipKey = `login-fail:${clientIpFrom(await headers())}`;
  const ipCheck = peek(ipKey, IP_FAILURES, IP_WINDOW_MS);
  if (!ipCheck.ok) {
    return { error: `Too many failed sign-ins from this network. Try again in ${Math.ceil(ipCheck.retryAfterSec / 60)} minutes.`, collegeId };
  }

  const user = await db.user.findUnique({
    where: { collegeId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      passwordHash: true,
      isActive: true,
      failedLoginCount: true,
      lockedUntil: true,
      mustChangePassword: true,
      sessionVersion: true,
      twoFactorEnabled: true,
      consentAt: true,
      roles: { select: { role: true } },
    },
  });

  const now = new Date();
  if (user?.lockedUntil && user.lockedUntil > now) {
    await logAudit({ actorId: user.id, action: "LOGIN_BLOCKED", details: { collegeId } });
    return {
      error: `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes or contact the college office.`,
      collegeId,
    };
  }

  // Always run bcrypt, even for unknown IDs, so timing does not leak which IDs exist.
  const passwordOk = await verifyPassword(password, user?.passwordHash);

  if (!user || !passwordOk) {
    hit(ipKey, IP_FAILURES, IP_WINDOW_MS);
    if (user) {
      const attempts = user.failedLoginCount + 1;
      const lock = attempts >= MAX_FAILED_ATTEMPTS;
      await db.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: lock ? 0 : attempts,
          lockedUntil: lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null,
        },
      });
    }
    await logAudit({
      actorId: user?.id,
      action: "LOGIN_FAILED",
      details: { collegeId, reason: user ? "bad_password" : "unknown_id" },
    });
    return { error: GENERIC_ERROR, collegeId };
  }

  if (!user.isActive) {
    await logAudit({ actorId: user.id, action: "LOGIN_FAILED", details: { collegeId, reason: "inactive" } });
    return { error: "This account is deactivated. Please contact the college office.", collegeId };
  }

  const roles = [...new Set(user.roles.map((r) => r.role))];
  if (roles.length === 0) {
    return { error: "No role is assigned to this account yet. Please contact the college office.", collegeId };
  }

  await db.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
  });

  // FR-3: staff who turned on two-step sign-in get a code before a session exists.
  if (user.twoFactorEnabled && !user.mustChangePassword) {
    const sent = await issueOtp(user, "TWO_FACTOR");
    if (!sent.ok) return { error: sent.error, collegeId };
    await setPending2fa(user.id);
    await logAudit({ actorId: user.id, action: "LOGIN_2FA_CODE_SENT" });
    const target = safeNextPath(next, roles);
    redirect(`/account/verify${target ? `?next=${encodeURIComponent(target)}` : ""}`);
  }

  await createSession(user.id, roles, user.sessionVersion);
  await logAudit({ actorId: user.id, action: "LOGIN_SUCCESS" });

  // FR-1: the first sign-in with an issued password also needs an OTP.
  if (user.mustChangePassword) redirect("/account/setup");
  // PRD §7: explicit consent before any data (including location) is collected.
  if (!user.consentAt) redirect("/account/consent");
  redirect(safeNextPath(next, roles) ?? homePathForRoles(roles));
}

export async function logout(): Promise<void> {
  const session = await readSession();
  await deleteSession();
  if (session) await logAudit({ actorId: session.userId, action: "LOGOUT" });
  redirect("/login");
}
