"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSession, deleteSession, readSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { homePathForRoles, safeNextPath } from "@/lib/roles";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

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

  const user = await db.user.findUnique({
    where: { collegeId },
    select: {
      id: true,
      passwordHash: true,
      isActive: true,
      failedLoginCount: true,
      lockedUntil: true,
      mustChangePassword: true,
      sessionVersion: true,
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
  await createSession(user.id, roles, user.sessionVersion);
  await logAudit({ actorId: user.id, action: "LOGIN_SUCCESS" });

  // FR-1: the first sign-in with an issued password also needs an OTP.
  if (user.mustChangePassword) redirect("/account/setup");
  redirect(safeNextPath(next, roles) ?? homePathForRoles(roles));
}

export async function logout(): Promise<void> {
  const session = await readSession();
  await deleteSession();
  if (session) await logAudit({ actorId: session.userId, action: "LOGOUT" });
  redirect("/login");
}
