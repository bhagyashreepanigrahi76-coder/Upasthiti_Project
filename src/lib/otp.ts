import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { OtpPurpose } from "@prisma/client";
import { db } from "./db";
import { sendMail, sendSms } from "./mailer";
import { APP_NAME } from "./config";

const TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

function hashCode(userId: string, purpose: OtpPurpose, code: string): string {
  const secret = process.env.SESSION_SECRET ?? "";
  return createHmac("sha256", secret).update(`${userId}:${purpose}:${code}`).digest("hex");
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}${"*".repeat(Math.max(2, local.length - 1))}@${domain}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `******${digits.slice(-4)}`;
}

type OtpUser = { id: string; name: string; email: string | null; phone: string | null };

/**
 * Sends a 6-digit code to the user's email (or phone if there is no email).
 * Re-requesting within 60 seconds does not send another code.
 */
export async function issueOtp(
  user: OtpUser,
  purpose: OtpPurpose,
): Promise<{ ok: true; sentTo: string } | { ok: false; error: string }> {
  const recent = await db.otpToken.findFirst({
    where: { userId: user.id, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (recent && Date.now() - recent.createdAt.getTime() < RESEND_COOLDOWN_SECONDS * 1000) {
    return { ok: true, sentTo: recent.sentTo };
  }
  if (!user.email && !user.phone) {
    return { ok: false, error: "No email or phone number is on file. Please contact the college office." };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const sentTo = user.email ? maskEmail(user.email) : maskPhone(user.phone!);
  const what = purpose === "FIRST_LOGIN" ? "verify your first sign-in" : "reset your password";
  const text = `Hello ${user.name},\n\nYour ${APP_NAME} code to ${what} is: ${code}\n\nIt expires in ${TTL_MINUTES} minutes. If you did not ask for this, ignore this message.`;

  if (user.email) await sendMail({ to: user.email, subject: `Your verification code: ${code}`, text });
  else await sendSms(user.phone!, `${APP_NAME} code: ${code} (valid ${TTL_MINUTES} min)`);

  await db.$transaction([
    db.otpToken.updateMany({ where: { userId: user.id, purpose, consumedAt: null }, data: { consumedAt: new Date() } }),
    db.otpToken.create({
      data: {
        userId: user.id,
        purpose,
        codeHash: hashCode(user.id, purpose, code),
        sentTo,
        expiresAt: new Date(Date.now() + TTL_MINUTES * 60_000),
      },
    }),
  ]);
  return { ok: true, sentTo };
}

export type OtpCheck = "ok" | "invalid" | "expired" | "locked";

/** Checks a code; each token allows 5 attempts and is single-use. */
export async function verifyOtp(userId: string, purpose: OtpPurpose, code: string): Promise<OtpCheck> {
  const token = await db.otpToken.findFirst({
    where: { userId, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!token || token.expiresAt < new Date()) return "expired";
  if (token.attempts >= MAX_ATTEMPTS) return "locked";

  const expected = Buffer.from(token.codeHash, "hex");
  const actual = Buffer.from(hashCode(userId, purpose, code.trim()), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    await db.otpToken.update({ where: { id: token.id }, data: { attempts: { increment: 1 } } });
    return "invalid";
  }
  await db.otpToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } });
  return "ok";
}

export const OTP_MESSAGES: Record<Exclude<OtpCheck, "ok">, string> = {
  invalid: "That code is not correct.",
  expired: "The code has expired or was already used. Request a new one.",
  locked: "Too many wrong codes. Request a new one.",
};
